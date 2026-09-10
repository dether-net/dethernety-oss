package daemoncmd

// The operator commands the console names when a change it has written needs the stack recreated to
// take effect. The console has no process control of its own — reaching the container runtime from a
// compose console means mounting the container socket, which is root-equivalent on the host — so it
// never restarts anything itself; it states the exact command the operator runs.
//
// Two scopes, and the rule is about WHICH VALUE moved, not which file was written. It used to be phrased
// as the latter — the stack for "a change to the mode layer", the platform for "a change to the modules
// directory" — which the allowlist apply falsifies: it rewrites the mode layer and needs only the platform.
//   - stackRestartCommand recreates the whole stack, for a change to values SEVERAL services read. A cloud
//     connect/disconnect rewrites the mode layer wholesale, so all of them must come up in the new mode.
//   - platformRestartCommand recreates only the platform, for a change to values ONLY the platform reads.
//     A content mount writes into the modules bind mount it loads at startup; the allowlist apply rewrites
//     DEPLOYMENT_ALLOWLIST, which only the platform reads, and leaves every other value alone.
const (
	stackRestartCommand    = "byodt restart"
	platformRestartCommand = "byodt restart platform"
)
