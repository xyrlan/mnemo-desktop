# mnemo-desktop shell integration, written by the app on every shell spawn: edits here are lost.
#
# The app starts zsh with ZDOTDIR pointing at this directory. Each bootstrap file sources the
# user's own copy with ZDOTDIR set back to theirs (MNEMO_USER_ZDOTDIR, default $HOME), then
# points it here again so zsh reads the next bootstrap file; the last file zsh reads restores
# ZDOTDIR for good. User files are sourced at top level, never inside a function, so their
# `typeset`s stay global. .zshrc adds the precmd hook that reports the cwd with OSC 7.

__mnemo_zdotdir=$ZDOTDIR

__mnemo_restore() {
  if [[ $MNEMO_USER_ZDOTDIR == $HOME ]]; then
    unset ZDOTDIR
  else
    ZDOTDIR=$MNEMO_USER_ZDOTDIR
  fi
  unset MNEMO_USER_ZDOTDIR __mnemo_zdotdir
  unfunction __mnemo_restore
}

export MNEMO_USER_ZDOTDIR=${MNEMO_USER_ZDOTDIR:-$HOME}
ZDOTDIR=$MNEMO_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zshenv ]] && source "$ZDOTDIR/.zshenv"
# The user's .zshenv may move ZDOTDIR (XDG setups): their later files come from there.
MNEMO_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$__mnemo_zdotdir

# A non-interactive, non-login zsh reads nothing after .zshenv.
[[ -o interactive || -o login ]] || __mnemo_restore
