# mnemo-desktop shell integration (see .zshenv here). Login shells only.

ZDOTDIR=$MNEMO_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zprofile ]] && source "$ZDOTDIR/.zprofile"
MNEMO_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$__mnemo_zdotdir
