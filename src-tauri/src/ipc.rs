//! One local transport for the app's helper binaries, on every system
//! (`docs/superpowers/specs/2026-11-10-recreation-core.md`, "A transport Windows has").
//!
//! A server binds a path in its app dir (`Listener::bind`), a client connects to the same path
//! (`Stream::connect`), and each then holds a `Stream` of bytes. What the path is differs:
//!
//! - **macOS and Linux**: a Unix socket, mode 0600. Nothing changed from when `mcp.rs` and
//!   `agent_hooks.rs` each bound their own, so a helper and an app of different builds still
//!   find each other.
//! - **Windows**: a named pipe, and the path is a small file that holds the pipe's name
//!   (`\\.\pipe\mnemo-desktop-<pid>-<random>`), written once the pipe answers. So the path keeps
//!   meaning what it means on Unix: the server bound last is the one reached, a path whose
//!   server died refuses at once, and an environment variable that names a socket names a file.
//!   That file is the contract between builds: its first line is the pipe's name.
//!
//! **Who may connect.** On Unix the socket's mode. On Windows the pipe is made with an owner and
//! one access entry, both the user the server runs as, and inherits none: no other account opens
//! it, and a process on another machine is refused whoever it says it is
//! (`PIPE_REJECT_REMOTE_CLIENTS`). Pipe names live in one namespace every account can list and
//! create in, so a client checks the other way too: it speaks only to a pipe whose owner is its
//! own user, and lets a server learn who it is but never act as it.
//!
//! **Both directions at once.** A `Stream` is read on one thread while another writes to a clone
//! of it, as the terminal daemon's client does; on Windows that takes overlapped I/O, which is
//! why this is not `std::fs::File` on a pipe. `shutdown` ends the reads and writes this process
//! has waiting on the stream. A Unix peer then reads end-of-stream; a Windows pipe has no half
//! close, so there the client's peer reads it once every clone is dropped, and the server's
//! peer at once, losing what it had not read yet.
//!
//! This file uses std (and `windows-sys` on Windows) and nothing of the app: the helpers
//! include it by path, as `mnemo-desktop-ptyd` includes `pty/wire.rs`.

use std::io::{self, Read, Write};
use std::path::Path;
use std::time::Duration;

/// A bound path, accepting clients.
pub struct Listener(imp::Listener);

/// One connection, either end of it.
pub struct Stream(imp::Stream);

impl Listener {
    /// Binds `path`, making its directory, and takes it from whatever held it: a server that
    /// died, a file, or a server still running, which keeps the clients it has and gets no more.
    pub fn bind(path: &Path) -> io::Result<Listener> {
        imp::Listener::bind(path).map(Listener)
    }

    /// The next client. Blocks.
    pub fn accept(&self) -> io::Result<Stream> {
        self.0.accept().map(Stream)
    }

    /// `accept`, forever.
    pub fn incoming(&self) -> impl Iterator<Item = io::Result<Stream>> + '_ {
        std::iter::repeat_with(move || self.accept())
    }
}

impl Stream {
    /// Connects to the server bound at `path`. Fails at once when none is: the path is missing,
    /// or what bound it is gone.
    pub fn connect(path: &Path) -> io::Result<Stream> {
        imp::Stream::connect(path).map(Stream)
    }

    /// The same connection again, for another thread. Timeouts and `shutdown` are the
    /// connection's, so every clone has them.
    pub fn try_clone(&self) -> io::Result<Stream> {
        self.0.try_clone().map(Stream)
    }

    /// How long a read waits for bytes before it fails; `None` waits for as long as it takes.
    pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.0.set_read_timeout(timeout)
    }

    /// How long a write waits for room before it fails; `None` waits for as long as it takes.
    pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.0.set_write_timeout(timeout)
    }

    /// Ends the connection for every clone: a read waiting on any of them returns.
    pub fn shutdown(&self) -> io::Result<()> {
        self.0.shutdown()
    }
}

impl Read for Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}

impl Read for &Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.0.read(buf)
    }
}

impl Write for Stream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Write for &Stream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(unix)]
mod imp {
    use std::io::{self, Read, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::Path;
    use std::time::Duration;

    pub struct Listener(UnixListener);
    pub struct Stream(UnixStream);

    impl Listener {
        pub fn bind(path: &Path) -> io::Result<Listener> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            if std::fs::symlink_metadata(path).is_ok() {
                std::fs::remove_file(path)?;
            }
            let listener = UnixListener::bind(path)?;
            // Other local users must not connect: whoever can reads this user's terminals.
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            Ok(Listener(listener))
        }

        pub fn accept(&self) -> io::Result<Stream> {
            self.0.accept().map(|(stream, _)| Stream(stream))
        }
    }

    impl Stream {
        pub fn connect(path: &Path) -> io::Result<Stream> {
            UnixStream::connect(path).map(Stream)
        }

        pub fn try_clone(&self) -> io::Result<Stream> {
            self.0.try_clone().map(Stream)
        }

        pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
            self.0.set_read_timeout(timeout)
        }

        pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
            self.0.set_write_timeout(timeout)
        }

        pub fn shutdown(&self) -> io::Result<()> {
            self.0.shutdown(std::net::Shutdown::Both)
        }

        pub fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
            (&self.0).read(buf)
        }

        pub fn write(&self, buf: &[u8]) -> io::Result<usize> {
            (&self.0).write(buf)
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::io::{self, Read};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard};
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, ERROR_ACCESS_DENIED, ERROR_BROKEN_PIPE, ERROR_HANDLE_EOF, ERROR_IO_PENDING, ERROR_NO_DATA,
        ERROR_OPERATION_ABORTED, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED, ERROR_SUCCESS, GENERIC_READ, GENERIC_WRITE, HANDLE,
        INVALID_HANDLE_VALUE, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1, SE_KERNEL_OBJECT,
    };
    use windows_sys::Win32::Security::{
        EqualSid, GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, OPEN_EXISTING, PIPE_ACCESS_DUPLEX, SECURITY_IDENTIFICATION,
        SECURITY_SQOS_PRESENT,
    };
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, WaitNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
        PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };
    use windows_sys::Win32::System::Threading::{CreateEventW, GetCurrentProcess, OpenProcessToken, WaitForSingleObject, INFINITE};
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

    /// Where every pipe lives on this machine. A name read from a file must start with it: any
    /// other is a file, or a pipe on another machine, which opening would hand this user's
    /// network logon to.
    pub(super) const NAMESPACE: &str = r"\\.\pipe\";
    /// The longest name a pipe may have, the namespace included.
    const NAME_MAX: usize = 256;
    /// Each direction's buffer, a hint the system rounds as it likes.
    const BUFFER: u32 = 64 * 1024;
    /// How long `connect` waits for a server that exists and has every instance taken: the
    /// moment between a client landing and the server putting up the next instance.
    const BUSY_WAIT: Duration = Duration::from_secs(2);

    /// A handle this module owns.
    struct Handle(HANDLE);

    // SAFETY: a kernel handle is a number any thread may use; what is done through each one
    // here is safe from any thread (overlapped I/O, events, `CloseHandle` once, on drop).
    unsafe impl Send for Handle {}
    unsafe impl Sync for Handle {}

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: the handle is this value's alone and still open.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn last() -> io::Error {
        io::Error::last_os_error()
    }

    fn os(code: u32) -> io::Error {
        io::Error::from_raw_os_error(code as i32)
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain([0]).collect()
    }

    fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A manual-reset event, not signalled: what an overlapped call reports its end through.
    fn event() -> io::Result<Handle> {
        // SAFETY: no name, no attributes; the handle is checked.
        let h = unsafe { CreateEventW(null(), 1, 0, null()) };
        if h.is_null() {
            Err(last())
        } else {
            Ok(Handle(h))
        }
    }

    /// The user this process runs as: the `TOKEN_USER` the system filled, its SID inside it.
    pub(super) struct Me(Vec<u64>);

    impl Me {
        pub(super) fn read() -> io::Result<Me> {
            let mut token: HANDLE = null_mut();
            // SAFETY: the process's own token, asked for reading only; the handle is checked.
            if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
                return Err(last());
            }
            let token = Handle(token);
            // `u64`s so the struct is aligned; a `TOKEN_USER` with the longest SID is 76 bytes.
            let mut buf = vec![0u64; 32];
            let mut len = 0u32;
            // SAFETY: `buf` is writable for the length given.
            if unsafe { GetTokenInformation(token.0, TokenUser, buf.as_mut_ptr().cast(), (buf.len() * 8) as u32, &mut len) } == 0 {
                return Err(last());
            }
            Ok(Me(buf))
        }

        pub(super) fn sid(&self) -> PSID {
            // SAFETY: `read` had the system write a `TOKEN_USER` at the start of the buffer.
            unsafe { (*self.0.as_ptr().cast::<TOKEN_USER>()).User.Sid }
        }

        /// The SID as security descriptors spell it, `S-1-5-21-…`.
        pub(super) fn text(&self) -> io::Result<String> {
            let mut text: *mut u16 = null_mut();
            // SAFETY: `sid` is valid while `self` lives; `text` is the system's to allocate.
            if unsafe { ConvertSidToStringSidW(self.sid(), &mut text) } == 0 {
                return Err(last());
            }
            // SAFETY: a NUL-terminated string the system allocated, freed once, here.
            unsafe {
                let len = (0..).take_while(|&i| *text.add(i) != 0).count();
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
                LocalFree(text.cast());
                Ok(s)
            }
        }
    }

    /// Who may open a pipe: a security descriptor the system allocated.
    pub(super) struct Guard(PSECURITY_DESCRIPTOR);

    // SAFETY: the descriptor is read-only memory once made, freed once, on drop.
    unsafe impl Send for Guard {}
    unsafe impl Sync for Guard {}

    impl Drop for Guard {
        fn drop(&mut self) {
            // SAFETY: allocated by `ConvertStringSecurityDescriptorToSecurityDescriptorW`.
            unsafe { LocalFree(self.0) };
        }
    }

    impl Guard {
        /// `me` owns the pipe and is the one account let in. `D:P` takes no entry from anywhere
        /// else, where a pipe made with no descriptor lets Everyone and the anonymous logon read.
        pub(super) fn owner_only(me: &Me) -> io::Result<Guard> {
            let sid = me.text()?;
            Guard::from_sddl(&format!("O:{sid}D:P(A;;GA;;;{sid})"))
        }

        pub(super) fn from_sddl(sddl: &str) -> io::Result<Guard> {
            let sddl = wide(sddl);
            let mut sd: PSECURITY_DESCRIPTOR = null_mut();
            // SAFETY: a NUL-terminated string in; `sd` is the system's to allocate.
            if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, null_mut()) } == 0 {
                return Err(last());
            }
            Ok(Guard(sd))
        }

        fn attributes(&self) -> SECURITY_ATTRIBUTES {
            SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: self.0, bInheritHandle: 0 }
        }
    }

    /// Whether `pipe` belongs to `me`. Only an administrator can make an object another user owns.
    fn owned_by(pipe: &Handle, me: &Me) -> io::Result<bool> {
        let mut owner: PSID = null_mut();
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        // SAFETY: an open handle; `owner` points into `sd`, which is freed once it was compared.
        unsafe {
            let code = GetSecurityInfo(pipe.0, SE_KERNEL_OBJECT, OWNER_SECURITY_INFORMATION, &mut owner, null_mut(), null_mut(), null_mut(), &mut sd);
            if code != ERROR_SUCCESS {
                return Err(os(code));
            }
            let same = !owner.is_null() && EqualSid(owner, me.sid()) != 0;
            LocalFree(sd);
            Ok(same)
        }
    }

    /// One instance of a pipe with no client yet, its connect already asked for: a client that
    /// writes and leaves before `accept` is called has still been heard.
    struct Waiting {
        pipe: Option<Handle>,
        /// Kept open for `connect`, which holds its handle.
        _event: Handle,
        connect: Box<OVERLAPPED>,
        pending: bool,
    }

    // SAFETY: the `OVERLAPPED` holds only the event's handle, and belongs to this value.
    unsafe impl Send for Waiting {}

    impl Waiting {
        /// A new instance of `name`. `first` refuses a name that exists, whoever made it.
        pub(super) fn new(name: &[u16], guard: &Guard, first: bool) -> io::Result<Waiting> {
            let open = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { 0 };
            let mode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
            let attributes = guard.attributes();
            // SAFETY: `name` is NUL-terminated and `attributes` outlives the call.
            let h = unsafe { CreateNamedPipeW(name.as_ptr(), open, mode, PIPE_UNLIMITED_INSTANCES, BUFFER, BUFFER, 0, &attributes) };
            if h == INVALID_HANDLE_VALUE {
                return Err(last());
            }
            let pipe = Handle(h);
            let event = event()?;
            // SAFETY: an `OVERLAPPED` of zeroes is a valid one.
            let mut connect: Box<OVERLAPPED> = Box::new(unsafe { std::mem::zeroed() });
            connect.hEvent = event.0;
            // SAFETY: `connect` is boxed and kept until the call ended (`accept`, `drop`).
            let pending = if unsafe { ConnectNamedPipe(pipe.0, &mut *connect) } != 0 {
                false
            } else {
                // SAFETY: reads this thread's last error.
                match unsafe { GetLastError() } {
                    ERROR_IO_PENDING => true,
                    // A client is there already, or was and left; what it wrote is still to read.
                    ERROR_PIPE_CONNECTED | ERROR_NO_DATA => false,
                    e => return Err(os(e)),
                }
            };
            Ok(Waiting { pipe: Some(pipe), _event: event, connect, pending })
        }

        /// Waits for the client and hands over its end of the pipe.
        fn connected(mut self) -> io::Result<Handle> {
            let pipe = self.pipe.take().expect("a waiting instance has its pipe");
            if self.pending {
                let mut n = 0u32;
                // SAFETY: the connect asked for in `new`, on the same handle and `OVERLAPPED`.
                let ok = unsafe { GetOverlappedResult(pipe.0, &*self.connect, &mut n, 1) };
                self.pending = false;
                if ok == 0 {
                    // SAFETY: reads this thread's last error.
                    let e = unsafe { GetLastError() };
                    if e != ERROR_PIPE_CONNECTED && e != ERROR_NO_DATA {
                        return Err(os(e));
                    }
                }
            }
            Ok(pipe)
        }
    }

    impl Drop for Waiting {
        fn drop(&mut self) {
            if let (true, Some(pipe)) = (self.pending, &self.pipe) {
                let mut n = 0u32;
                // SAFETY: the connect is still out: it is called off and waited for, so the
                // system is done with `connect` before the box is freed.
                unsafe {
                    CancelIoEx(pipe.0, &*self.connect);
                    GetOverlappedResult(pipe.0, &*self.connect, &mut n, 1);
                }
            }
        }
    }

    pub struct Listener {
        name: Vec<u16>,
        guard: Guard,
        /// The instance the next client lands on. `None` only after one could not be made.
        waiting: Mutex<Option<Waiting>>,
    }

    impl Listener {
        pub fn bind(path: &Path) -> io::Result<Listener> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            let guard = Guard::owner_only(&Me::read()?)?;
            let mut tries = 0;
            let (name, waiting) = loop {
                let name = fresh_name();
                match Waiting::new(&wide(&name), &guard, true) {
                    Ok(w) => break (name, w),
                    // The name exists: someone else's pipe, never one to add an instance to.
                    Err(e) if e.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) && tries < 8 => tries += 1,
                    Err(e) => return Err(e),
                }
            };
            // Named last, and in one step: a client never reads half a name, or a name with no
            // pipe behind it yet.
            let mut tmp = path.as_os_str().to_owned();
            tmp.push(format!(".{}.tmp", std::process::id()));
            std::fs::write(&tmp, format!("{name}\n"))?;
            if let Err(e) = std::fs::rename(&tmp, path) {
                let _ = std::fs::remove_file(&tmp);
                return Err(e);
            }
            Ok(Listener { name: wide(&name), guard, waiting: Mutex::new(Some(waiting)) })
        }

        pub fn accept(&self) -> io::Result<Stream> {
            let mut waiting = lock(&self.waiting);
            let this = match waiting.take() {
                Some(w) => w,
                None => Waiting::new(&self.name, &self.guard, false)?,
            };
            let pipe = this.connected();
            // The next instance before this client is served, so the name always has one.
            *waiting = Waiting::new(&self.name, &self.guard, false).ok();
            Stream::over(pipe?, true)
        }
    }

    /// A pipe name nobody holds: the process, and 64 bits std seeds from the system. Unique,
    /// not secret; the pipe's own access list is what keeps others out.
    fn fresh_name() -> String {
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        format!("{NAMESPACE}mnemo-desktop-{}-{:016x}", std::process::id(), h.finish())
    }

    /// The pipe the file at `path` names.
    fn read_name(path: &Path) -> io::Result<String> {
        let mut text = String::new();
        std::fs::File::open(path)?.take(4 * NAME_MAX as u64).read_to_string(&mut text)?;
        let name = text.lines().next().unwrap_or_default().trim();
        let local = name.strip_prefix(NAMESPACE).is_some_and(|rest| !rest.is_empty() && !rest.contains(['\\', '/']));
        if !local || name.len() > NAME_MAX {
            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("{} names no pipe of this machine", path.display())));
        }
        Ok(name.to_owned())
    }

    struct Pipe {
        handle: Handle,
        /// Made by `accept`: only that end can cut the other off.
        server: bool,
        /// One read at a time, and the event it waits on; the same for writes.
        reading: Mutex<Handle>,
        writing: Mutex<Handle>,
        read_timeout: Mutex<Option<Duration>>,
        write_timeout: Mutex<Option<Duration>>,
        closed: AtomicBool,
    }

    pub struct Stream(Arc<Pipe>);

    impl Stream {
        fn over(handle: Handle, server: bool) -> io::Result<Stream> {
            Ok(Stream(Arc::new(Pipe {
                handle,
                server,
                reading: Mutex::new(event()?),
                writing: Mutex::new(event()?),
                read_timeout: Mutex::new(None),
                write_timeout: Mutex::new(None),
                closed: AtomicBool::new(false),
            })))
        }

        pub fn connect(path: &Path) -> io::Result<Stream> {
            Stream::connect_as(path, &Me::read()?)
        }

        /// `connect`, by the user `me`: the pipe must be that user's.
        pub(super) fn connect_as(path: &Path, me: &Me) -> io::Result<Stream> {
            let name = wide(&read_name(path)?);
            let deadline = Instant::now() + BUSY_WAIT;
            let handle = loop {
                // Overlapped, like the server's end. `SECURITY_IDENTIFICATION`: whoever serves
                // this pipe may learn which user connected, and may not act as that user.
                let flags = FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION;
                // SAFETY: `name` is NUL-terminated; the handle is checked.
                let h = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ | GENERIC_WRITE, 0, null(), OPEN_EXISTING, flags, null_mut()) };
                if h != INVALID_HANDLE_VALUE {
                    break Handle(h);
                }
                // SAFETY: reads this thread's last error.
                let e = unsafe { GetLastError() };
                let left = deadline.saturating_duration_since(Instant::now());
                if e != ERROR_PIPE_BUSY || left.is_zero() {
                    return Err(os(e));
                }
                // SAFETY: `name` is NUL-terminated.
                unsafe { WaitNamedPipeW(name.as_ptr(), left.as_millis().max(1) as u32) };
            };
            if !owned_by(&handle, me)? {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, format!("the pipe {} names belongs to another user", path.display())));
            }
            Stream::over(handle, false)
        }

        pub fn try_clone(&self) -> io::Result<Stream> {
            Ok(Stream(Arc::clone(&self.0)))
        }

        pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
            *lock(&self.0.read_timeout) = timeout;
            Ok(())
        }

        pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
            *lock(&self.0.write_timeout) = timeout;
            Ok(())
        }

        pub fn shutdown(&self) -> io::Result<()> {
            let pipe = &*self.0;
            pipe.closed.store(true, Ordering::SeqCst);
            // SAFETY: an open handle. Every read and write waiting on it ends; one asked for
            // after this sweep sees `closed` and calls itself off (`transfer`).
            unsafe {
                CancelIoEx(pipe.handle.0, null());
                if pipe.server {
                    DisconnectNamedPipe(pipe.handle.0);
                }
            }
            Ok(())
        }

        pub fn read(&self, buf: &mut [u8]) -> io::Result<usize> {
            let pipe = &*self.0;
            let event = lock(&pipe.reading);
            let timeout = *lock(&pipe.read_timeout);
            let len = buf.len().min(u32::MAX as usize) as u32;
            // SAFETY: `buf` is writable for `len` and outlives the call: `transfer` returns
            // only once the system is done with it.
            let read = pipe.transfer(&event, timeout, |o| unsafe { ReadFile(pipe.handle.0, buf.as_mut_ptr(), len, null_mut(), o) });
            match read {
                // The other end left, or this one was shut down: the end of the stream.
                Err(e) if matches!(e.raw_os_error().map(|c| c as u32), Some(ERROR_BROKEN_PIPE | ERROR_PIPE_NOT_CONNECTED | ERROR_HANDLE_EOF | ERROR_NO_DATA)) => Ok(0),
                Err(_) if pipe.closed.load(Ordering::SeqCst) => Ok(0),
                other => other,
            }
        }

        pub fn write(&self, buf: &[u8]) -> io::Result<usize> {
            let pipe = &*self.0;
            let event = lock(&pipe.writing);
            let timeout = *lock(&pipe.write_timeout);
            let len = buf.len().min(u32::MAX as usize) as u32;
            // SAFETY: `buf` is readable for `len` and outlives the call, as in `read`.
            pipe.transfer(&event, timeout, |o| unsafe { WriteFile(pipe.handle.0, buf.as_ptr(), len, null_mut(), o) })
        }
    }

    impl Pipe {
        /// One overlapped read or write, `start`ed and waited for here, for `timeout` at most.
        /// It never returns while the system still holds the buffer or the `OVERLAPPED`.
        fn transfer(&self, event: &Handle, timeout: Option<Duration>, start: impl FnOnce(*mut OVERLAPPED) -> i32) -> io::Result<usize> {
            if self.closed.load(Ordering::SeqCst) {
                return Err(os(ERROR_PIPE_NOT_CONNECTED));
            }
            // SAFETY: an `OVERLAPPED` of zeroes is a valid one.
            let mut o: OVERLAPPED = unsafe { std::mem::zeroed() };
            o.hEvent = event.0;
            let mut timed_out = false;
            if start(&mut o) == 0 {
                // SAFETY: reads this thread's last error.
                let e = unsafe { GetLastError() };
                if e != ERROR_IO_PENDING {
                    return Err(os(e));
                }
                // `shutdown` may have swept before this call was out.
                if self.closed.load(Ordering::SeqCst) {
                    // SAFETY: this call's own `OVERLAPPED`, still out.
                    unsafe { CancelIoEx(self.handle.0, &o) };
                }
                let ms = timeout.map_or(INFINITE, |t| t.as_millis().clamp(1, (INFINITE - 1) as u128) as u32);
                // SAFETY: the event belongs to this call, held through the caller's lock.
                if unsafe { WaitForSingleObject(event.0, ms) } == WAIT_TIMEOUT {
                    timed_out = true;
                    // SAFETY: this call's own `OVERLAPPED`, still out.
                    unsafe { CancelIoEx(self.handle.0, &o) };
                }
            }
            let mut n = 0u32;
            // SAFETY: waits for the call to end, called off or not, and reads what it moved.
            if unsafe { GetOverlappedResult(self.handle.0, &o, &mut n, 1) } != 0 {
                return Ok(n as usize);
            }
            // SAFETY: reads this thread's last error.
            match unsafe { GetLastError() } {
                ERROR_OPERATION_ABORTED if timed_out => Err(io::ErrorKind::TimedOut.into()),
                e => Err(os(e)),
            }
        }
    }

    /// What the tests below need of this module's insides.
    #[cfg(test)]
    pub(super) mod probe {
        use super::*;
        use windows_sys::Win32::Security::Authorization::{ConvertSecurityDescriptorToStringSecurityDescriptorW, ConvertStringSidToSidW};
        use windows_sys::Win32::Security::{CopySid, ImpersonateAnonymousToken, RevertToSelf, DACL_SECURITY_INFORMATION};
        use windows_sys::Win32::System::Threading::GetCurrentThread;

        /// A pipe of a fresh name guarded by `sddl`, kept open while the value lives.
        pub fn pipe_guarded_by(sddl: &str) -> (String, impl Sized) {
            let name = fresh_name();
            let guard = Guard::from_sddl(sddl).unwrap();
            let waiting = Waiting::new(&wide(&name), &guard, true).unwrap();
            (name, (waiting, guard))
        }

        /// `sddl` as the system itself spells that descriptor: it writes an account it has a
        /// short name for by that name (`LA`, the built-in administrator a CI runner works as).
        pub fn spelled(sddl: &str) -> String {
            let guard = Guard::from_sddl(sddl).unwrap();
            // SAFETY: test code; a descriptor the system just made, and its own string.
            unsafe {
                let what = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
                let mut text: *mut u16 = null_mut();
                assert_ne!(ConvertSecurityDescriptorToStringSecurityDescriptorW(guard.0, SDDL_REVISION_1, what, &mut text, null_mut()), 0);
                let len = (0..).take_while(|&i| *text.add(i) != 0).count();
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
                LocalFree(text.cast());
                s
            }
        }

        /// Who owns the pipe called `name` and who it lets in, as a security descriptor spells it.
        pub fn guard_of(name: &str) -> String {
            let name = wide(name);
            // SAFETY: test code; every pointer is checked or the system's own.
            unsafe {
                let h = CreateFileW(name.as_ptr(), GENERIC_READ | GENERIC_WRITE, 0, null(), OPEN_EXISTING, FILE_FLAG_OVERLAPPED, null_mut());
                assert_ne!(h, INVALID_HANDLE_VALUE, "{}", last());
                let pipe = Handle(h);
                let what = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
                let mut sd: PSECURITY_DESCRIPTOR = null_mut();
                assert_eq!(GetSecurityInfo(pipe.0, SE_KERNEL_OBJECT, what, null_mut(), null_mut(), null_mut(), null_mut(), &mut sd), ERROR_SUCCESS);
                let mut text: *mut u16 = null_mut();
                assert_ne!(ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, SDDL_REVISION_1, what, &mut text, null_mut()), 0);
                let len = (0..).take_while(|&i| *text.add(i) != 0).count();
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
                LocalFree(text.cast());
                LocalFree(sd);
                s
            }
        }

        /// Opens the pipe called `name` as the anonymous logon, an account that is not this
        /// user: the system's error code, or `None` when it was let in.
        pub fn open_as_anonymous(name: &str) -> Option<u32> {
            let name = wide(name);
            // Its own thread: the impersonation is the thread's, and ends with it either way.
            std::thread::spawn(move || unsafe {
                assert_ne!(ImpersonateAnonymousToken(GetCurrentThread()), 0, "{}", last());
                let h = CreateFileW(name.as_ptr(), GENERIC_READ, 0, null(), OPEN_EXISTING, FILE_FLAG_OVERLAPPED, null_mut());
                let code = (h == INVALID_HANDLE_VALUE).then(|| GetLastError());
                RevertToSelf();
                if code.is_none() {
                    CloseHandle(h);
                }
                code
            })
            .join()
            .unwrap()
        }

        pub fn me() -> String {
            Me::read().unwrap().text().unwrap()
        }

        /// `Stream::connect`, as the user whose SID is `sid` would see the pipe's owner.
        pub fn connect_as(path: &Path, sid: &str) -> io::Result<()> {
            let sid = wide(sid);
            let header = std::mem::size_of::<TOKEN_USER>().div_ceil(8);
            // A `TOKEN_USER` as `Me::read` gets one: the struct, then the SID it points at.
            let mut buf = vec![0u64; header + 16];
            // SAFETY: test code; the SID is copied into `buf`, which outlives every use of it.
            unsafe {
                let mut parsed: PSID = null_mut();
                assert_ne!(ConvertStringSidToSidW(sid.as_ptr(), &mut parsed), 0, "{}", last());
                let at = buf.as_mut_ptr().add(header);
                assert_ne!(CopySid(128, at.cast(), parsed), 0, "{}", last());
                LocalFree(parsed);
                (*buf.as_mut_ptr().cast::<TOKEN_USER>()).User.Sid = at.cast();
            }
            Stream::connect_as(path, &Me(buf)).map(drop)
        }

        pub const DENIED: u32 = ERROR_ACCESS_DENIED;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::Instant;

    /// A fresh directory. Short: a Unix socket's path must fit in about a hundred bytes.
    fn scratch(tag: &str) -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("mi-{tag}-{nanos:x}-{n}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A server at `path` that answers every line with `<tag>:<line>`.
    fn echo(path: &Path, tag: &'static str) {
        let listener = Listener::bind(path).unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let stream = stream.unwrap();
                std::thread::spawn(move || {
                    let mut out = stream.try_clone().unwrap();
                    for line in BufReader::new(stream).lines() {
                        let Ok(line) = line else { break };
                        if writeln!(out, "{tag}:{line}").is_err() {
                            break;
                        }
                    }
                });
            }
        });
    }

    fn ask(path: &Path, line: &str) -> String {
        let stream = Stream::connect(path).unwrap();
        writeln!(&stream, "{line}").unwrap();
        let mut answer = String::new();
        BufReader::new(stream).read_line(&mut answer).unwrap();
        answer.trim_end().to_owned()
    }

    /// `f` on its own thread, failing the test when it has not ended in ten seconds: a transport
    /// that blocks where it should not must fail the run, not hang it.
    fn within<T: Send + 'static>(what: &str, f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || tx.send(f()));
        rx.recv_timeout(Duration::from_secs(10)).unwrap_or_else(|_| panic!("{what}: still waiting after 10 s"))
    }

    #[test]
    fn a_line_goes_each_way_over_a_path_that_held_something_else() {
        let dir = scratch("line");
        let path = dir.join("deep").join("a.sock");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "stale").unwrap();
        echo(&path, "a");
        assert_eq!(ask(&path, "one"), "a:one");
        // Several lines on one connection, as the MCP binary's calls go.
        let stream = Stream::connect(&path).unwrap();
        let mut lines = BufReader::new(stream.try_clone().unwrap()).lines();
        for word in ["two", "three"] {
            writeln!(&stream, "{word}").unwrap();
            assert_eq!(lines.next().unwrap().unwrap(), format!("a:{word}"));
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bind_makes_the_directory_it_is_given() {
        let dir = scratch("mkdir");
        let path = dir.join("not").join("there").join("a.sock");
        echo(&path, "d");
        assert_eq!(ask(&path, "x"), "d:x");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_server_bound_last_is_the_one_reached() {
        let dir = scratch("last");
        let path = dir.join("a.sock");
        echo(&path, "first");
        assert_eq!(ask(&path, "x"), "first:x");
        echo(&path, "second");
        for _ in 0..4 {
            assert_eq!(ask(&path, "x"), "second:x");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn with_no_server_connect_fails_at_once() {
        let dir = scratch("none");
        let start = Instant::now();
        assert!(Stream::connect(&dir.join("missing.sock")).is_err());
        // A path whose server is gone, as a crashed app leaves it.
        let dead = dir.join("dead.sock");
        drop(Listener::bind(&dead).unwrap());
        assert!(dead.exists(), "the path outlives its server");
        assert!(Stream::connect(&dead).is_err());
        // And one that never was a server's.
        let file = dir.join("file.sock");
        std::fs::write(&file, "not a server").unwrap();
        assert!(Stream::connect(&file).is_err());
        assert!(start.elapsed() < Duration::from_secs(1), "took {:?}", start.elapsed());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The hook's way: connect, write one line, leave, all before the app gets to `accept`.
    #[test]
    fn a_client_that_wrote_and_left_before_accept_is_still_heard() {
        let dir = scratch("left");
        let path = dir.join("a.sock");
        let listener = Listener::bind(&path).unwrap();
        for word in ["one", "two"] {
            let stream = Stream::connect(&path).unwrap();
            writeln!(&stream, "{word}").unwrap();
            drop(stream);
            let heard = within("reading a client that left", {
                let server = listener.accept().unwrap();
                move || {
                    let mut all = String::new();
                    (&server).read_to_string(&mut all).map(|_| all)
                }
            });
            assert_eq!(heard.unwrap(), format!("{word}\n"), "then the end of the stream");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The terminal daemon's client: one thread sits in `read` for whatever the daemon sends
    /// next while others write requests to the same connection.
    #[test]
    fn a_clone_writes_while_another_waits_in_read() {
        let dir = scratch("duplex");
        let path = dir.join("a.sock");
        echo(&path, "d");
        let stream = Stream::connect(&path).unwrap();
        let reader = stream.try_clone().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let _ = BufReader::new(reader).read_line(&mut line);
            let _ = tx.send(line);
        });
        // Long enough for that read to be out and waiting.
        std::thread::sleep(Duration::from_millis(200));
        within("a write beside a waiting read", move || writeln!(&stream, "ping").unwrap());
        assert_eq!(rx.recv_timeout(Duration::from_secs(10)).expect("the answer to the write"), "d:ping\n");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_read_gives_up_at_its_timeout_and_the_connection_lives_on() {
        let dir = scratch("timeout");
        let path = dir.join("a.sock");
        echo(&path, "t");
        let stream = Stream::connect(&path).unwrap();
        stream.set_read_timeout(Some(Duration::from_millis(100))).unwrap();
        let start = Instant::now();
        let quiet = within("a read with a timeout", {
            let stream = stream.try_clone().unwrap();
            move || (&stream).read(&mut [0u8; 8])
        });
        let kind = quiet.expect_err("nothing was sent").kind();
        assert!(matches!(kind, io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock), "{kind:?}");
        assert!(start.elapsed() >= Duration::from_millis(90), "gave up after {:?}", start.elapsed());
        stream.set_read_timeout(None).unwrap();
        writeln!(&stream, "still").unwrap();
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        assert_eq!(line, "t:still\n");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn shutdown_ends_a_read_waiting_on_a_clone() {
        let dir = scratch("shut");
        for client_shuts in [true, false] {
            let path = dir.join(format!("{client_shuts}.sock"));
            let listener = Listener::bind(&path).unwrap();
            let client = Stream::connect(&path).unwrap();
            let server = listener.accept().unwrap();
            let (shut, waits) = if client_shuts { (client, server) } else { (server, client) };
            let mine = shut.try_clone().unwrap();
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || tx.send((&mine).read(&mut [0u8; 8]).unwrap_or(0)));
            std::thread::sleep(Duration::from_millis(200));
            shut.shutdown().unwrap();
            assert_eq!(rx.recv_timeout(Duration::from_secs(10)).expect("the waiting read returns"), 0);
            assert_eq!((&shut).read(&mut [0u8; 8]).unwrap_or(0), 0, "and so does every read after");
            // The other end reads the end of the stream once this one is gone.
            drop(shut);
            assert_eq!(within("the other end's read", move || (&waits).read(&mut [0u8; 8]).unwrap_or(0)), 0);
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn clients_arriving_together_are_each_answered() {
        let dir = scratch("many");
        let path = dir.join("a.sock");
        echo(&path, "m");
        let asking: Vec<_> = (0..24)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || ask(&path, &i.to_string()))
            })
            .collect();
        let answers: Vec<String> = asking.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(answers, (0..24).map(|i| format!("m:{i}")).collect::<Vec<_>>());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Between a client landing and the server's next `accept`, the server may have no instance
    /// free (a Windows pipe; a Unix socket queues). A client that arrives then waits for it.
    #[test]
    fn a_client_waits_for_a_server_that_has_not_come_back_to_accept() {
        let dir = scratch("busy");
        let path = dir.join("a.sock");
        let listener = Listener::bind(&path).unwrap();
        let first = Stream::connect(&path).unwrap();
        let accepting = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            let one = listener.accept().unwrap();
            let two = listener.accept().unwrap();
            for (stream, word) in [(&one, "one"), (&two, "two")] {
                let mut s = stream;
                writeln!(s, "{word}").unwrap();
            }
            (one, two)
        });
        let second = within("a connect while the server is busy", {
            let path = path.clone();
            move || Stream::connect(&path)
        })
        .expect("the client waited for the server");
        for (stream, word) in [(first, "one"), (second, "two")] {
            let mut line = String::new();
            BufReader::new(stream).read_line(&mut line).unwrap();
            assert_eq!(line.trim_end(), word);
        }
        drop(accepting.join().unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A server is not always sitting in `accept`: it serves a client, then comes back. Whoever
    /// connects meanwhile is let in, not told that nobody is there.
    #[test]
    fn a_client_arriving_between_two_accepts_is_not_turned_away() {
        let dir = scratch("between");
        let path = dir.join("a.sock");
        let listener = Listener::bind(&path).unwrap();
        let mut served = Vec::new();
        for word in ["one", "two", "three"] {
            // Nothing is in `accept` while this client connects and writes.
            let client = Stream::connect(&path).unwrap_or_else(|e| panic!("{word}: {e}"));
            writeln!(&client, "{word}").unwrap();
            let server = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(server.try_clone().unwrap()).read_line(&mut line).unwrap();
            assert_eq!(line.trim_end(), word);
            served.push((client, server));
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_is_its_owners_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("mode");
        let path = dir.join("a.sock");
        let _listener = Listener::bind(&path).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    fn pipe_at(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap().trim().to_owned()
    }

    /// What stands in for the socket's mode on Windows.
    #[cfg(windows)]
    #[test]
    fn the_pipe_is_its_owners_alone() {
        use imp::probe;
        let dir = scratch("guard");
        let path = dir.join("a.sock");
        let listener = Listener::bind(&path).unwrap();
        let name = pipe_at(&path);
        assert!(name.starts_with(imp::NAMESPACE), "{name}");
        // Owned by this user, one entry, this user's, and none inherited (`P`).
        let me = probe::me();
        let alone = probe::spelled(&format!("O:{me}D:P(A;;FA;;;{me})"));
        assert_eq!(probe::guard_of(&name), alone);
        // What that comparison can tell apart: a second entry, and entries taken from elsewhere.
        assert_ne!(alone, probe::spelled(&format!("O:{me}D:P(A;;FA;;;{me})(A;;FR;;;AN)")));
        assert_ne!(alone, probe::spelled(&format!("O:{me}D:(A;;FA;;;{me})")));
        drop(listener.accept());

        // Another account is refused: the anonymous logon, the one this process can become.
        assert_eq!(probe::open_as_anonymous(&name), Some(probe::DENIED));
        // It is the pipe's guard that refused it, not the system: a pipe whose guard names the
        // anonymous logon lets it in.
        let (open, _kept) = probe::pipe_guarded_by(&format!("O:{me}D:(A;;GA;;;{me})(A;;GRGW;;;AN)"));
        assert_eq!(probe::open_as_anonymous(&open), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The other direction: a pipe's name is no secret, and whoever takes it after the app is
    /// gone could answer in the app's place. A client speaks only to a pipe its own user owns.
    #[cfg(windows)]
    #[test]
    fn a_client_speaks_only_to_a_pipe_its_own_user_owns() {
        use imp::probe;
        let dir = scratch("owner");
        let path = dir.join("a.sock");
        echo(&path, "o");
        probe::connect_as(&path, &probe::me()).expect("this user's own pipe");
        // Everyone, then the system: neither is the user who made this pipe.
        for other in ["S-1-1-0", "S-1-5-18"] {
            let e = probe::connect_as(&path, other).expect_err(other);
            assert_eq!(e.kind(), io::ErrorKind::PermissionDenied, "{other}: {e}");
        }
        assert_eq!(ask(&path, "still"), "o:still", "and the server is none the worse for it");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The file names a pipe on this machine or nothing: never a file, never another machine.
    #[cfg(windows)]
    #[test]
    fn a_path_that_names_anything_but_a_local_pipe_is_refused() {
        let dir = scratch("names");
        let path = dir.join("a.sock");
        let target = dir.join("secret.txt");
        std::fs::write(&target, "x").unwrap();
        let long = format!(r"\\.\pipe\{}", "p".repeat(300));
        for named in [target.to_str().unwrap(), r"\\elsewhere\pipe\mnemo-desktop-1", r"\\.\pipe\", r"\\.\pipe\a\..\b", r"//./pipe/x", "", &long] {
            std::fs::write(&path, format!("{named}\n")).unwrap();
            let e = Stream::connect(&path).err().unwrap_or_else(|| panic!("{named:?} was connected to"));
            assert_eq!(e.kind(), io::ErrorKind::InvalidData, "{named:?}: {e}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A second server never joins the first one's pipe: each bind has a pipe of its own, so a
    /// client is never handed to whichever of two servers happens to be free.
    #[cfg(windows)]
    #[test]
    fn each_bind_has_a_pipe_of_its_own() {
        let dir = scratch("own");
        let path = dir.join("a.sock");
        let _first = Listener::bind(&path).unwrap();
        let one = pipe_at(&path);
        let _second = Listener::bind(&path).unwrap();
        assert_ne!(pipe_at(&path), one);
        assert!(!std::fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().ends_with(".tmp")), "no half-written name is left");
        let _ = std::fs::remove_dir_all(dir);
    }
}
