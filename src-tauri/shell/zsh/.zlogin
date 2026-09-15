# mnemo-desktop shell integration (see .zshenv here). Login shells only; the last file zsh reads.

ZDOTDIR=$MNEMO_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zlogin ]] && source "$ZDOTDIR/.zlogin"
MNEMO_USER_ZDOTDIR=$ZDOTDIR
__mnemo_restore
