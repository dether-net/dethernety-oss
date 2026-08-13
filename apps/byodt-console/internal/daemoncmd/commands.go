package daemoncmd

// The operator commands the console names when a change it has written needs the stack recreated to
// take effect. The console has no process control of its own — reaching the container runtime from a
// compose console means mounting the container socket, which is root-equivalent on the host — so it
// never restarts anything itself; it states the exact command the operator runs.
//
// Two scopes, because the two kinds of change apply differently:
//   - stackRestartCommand recreates the whole stack. A cloud connect/disconnect rewrites the mode
//     layer that several services read (env_file), so all of them must come up in the new mode.
//   - platformRestartCommand recreates only the platform. A content mount writes into the modules
//     bind mount that only the platform reads at startup, so nothing else needs to move.
const (
	stackRestartCommand    = "byodt restart"
	platformRestartCommand = "byodt restart platform"
)
