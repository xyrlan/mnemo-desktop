# mnemo-desktop shell integration for Windows PowerShell and PowerShell 7. The app passes this to
# the shell as `-NoExit -EncodedCommand`, after the person's profile has run: no file is run, so
# no execution policy stands in the way.
#
# It wraps whatever `prompt` the profile left (the default one, starship's, oh-my-posh's) so that
# each prompt first reports the folder with OSC 9;9, as Windows Terminal reads it. Set
# MNEMO_NO_SHELL_INTEGRATION=1 to skip it.

$global:__mnemo_prompt = $function:prompt
function global:prompt {
  # First, while `$?` is still the last command's, for a prompt that shows it.
  $out = & $global:__mnemo_prompt
  $loc = $executionContext.SessionState.Path.CurrentLocation
  if ($env:MNEMO_NO_SHELL_INTEGRATION -ne '1' -and $loc.Provider.Name -eq 'FileSystem') {
    "$([char]27)]9;9;$($loc.ProviderPath)$([char]27)\" + $out
  } else {
    $out
  }
}
