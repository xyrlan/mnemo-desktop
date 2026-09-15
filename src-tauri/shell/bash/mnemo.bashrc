# mnemo-desktop shell integration, written by the app on every shell spawn: edits here are lost.
#
# The app starts bash as `bash --rcfile <this file>`. bash ignores --rcfile in a login shell,
# so it runs non-login and this file loads what bash itself would have: the login files when
# MNEMO_BASH_LOGIN=1, else ~/.bashrc. Then it adds a PROMPT_COMMAND hook that reports the cwd
# with OSC 7.

if [ "$MNEMO_BASH_LOGIN" = 1 ]; then
  [ -r /etc/profile ] && . /etc/profile
  for __mnemo_rc in ~/.bash_profile ~/.bash_login ~/.profile; do
    if [ -r "$__mnemo_rc" ]; then
      . "$__mnemo_rc"
      break
    fi
  done
  unset __mnemo_rc
else
  [ -r ~/.bashrc ] && . ~/.bashrc
fi
unset MNEMO_BASH_LOGIN

# Percent-encoded byte by byte, as /etc/bashrc_Apple_Terminal does. Runs first in
# PROMPT_COMMAND and hands back $? so the user's own prompt commands still see it.
if [ "$MNEMO_NO_SHELL_INTEGRATION" != 1 ]; then
  __mnemo_osc7() {
    local status=$? LC_ALL=C url_path='' i ch byte
    for ((i = 0; i < ${#PWD}; i++)); do
      ch=${PWD:i:1}
      case $ch in
        [/._~A-Za-z0-9-]) url_path+=$ch ;;
        # bash 3.2 (macOS) sign-extends bytes above 0x7F: mask to one byte.
        *) printf -v byte '%d' "'$ch"; printf -v ch '%%%02X' $((byte & 255)); url_path+=$ch ;;
      esac
    done
    printf '\e]7;file://%s%s\a' "$HOSTNAME" "$url_path"
    return $status
  }
  PROMPT_COMMAND="__mnemo_osc7${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
