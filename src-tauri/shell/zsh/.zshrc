# mnemo-desktop shell integration (see .zshenv here). Interactive shells only.

ZDOTDIR=$MNEMO_USER_ZDOTDIR
# /etc/zshrc (macOS) ran just before this with ZDOTDIR still pointing here, so its
# HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history names this directory: point it back at the user's.
[[ $HISTFILE == $__mnemo_zdotdir/.zsh_history ]] && HISTFILE=$ZDOTDIR/.zsh_history
[[ -f $ZDOTDIR/.zshrc ]] && source "$ZDOTDIR/.zshrc"
MNEMO_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$__mnemo_zdotdir

# Report the cwd at each prompt so new panes open where this one is. Percent-encoded
# byte by byte, as /etc/zshrc_Apple_Terminal does. Set MNEMO_NO_SHELL_INTEGRATION=1 in
# your own startup files to skip it.
if [[ $MNEMO_NO_SHELL_INTEGRATION != 1 ]]; then
  __mnemo_osc7() {
    emulate -L zsh
    local url_path='' i ch hexch LC_CTYPE=C LC_COLLATE=C LC_ALL= LANG=
    for ((i = 1; i <= ${#PWD}; ++i)); do
      ch=$PWD[i]
      if [[ $ch == [/._~A-Za-z0-9-] ]]; then
        url_path+=$ch
      else
        printf -v hexch '%02X' "'$ch"
        url_path+="%$hexch"
      fi
    done
    printf '\e]7;%s\a' "file://$HOST$url_path"
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd __mnemo_osc7
fi

# A login shell still reads .zlogin, which restores ZDOTDIR.
[[ -o login ]] || __mnemo_restore
