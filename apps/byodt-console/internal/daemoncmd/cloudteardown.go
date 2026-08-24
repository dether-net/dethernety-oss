package daemoncmd

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dether-net/dethernety-oss/apps/byodt-console/internal/moduleinstall"
)

// What a disconnect takes with it.
//
// A cloud connection puts three kinds of module into the modules mount, each told apart by the marker
// file the console wrote beside it: a content mount from the catalog, an installed artifact, and the
// knowledge-graph connection. All three exist only because this deployment was connected, so a
// disconnect removes all three. The operator asked to stop using the cloud, and a deployment the console
// reports as pure-OSS while it still serves cloud-provided modules is not one.
//
// THE CONSOLE DELETES FILES AND NOTHING ELSE. It issues no database command on this path and holds no
// credential for one. What the platform then does with a module it no longer finds is the platform's own
// startup reconciliation, and it is named in the confirmation the operator accepts BEFORE any of this
// runs — see artifactRemovalConsequence, which the disconnect card carries for exactly that reason.

type cloudMountKind string

const (
	kindContentMount   cloudMountKind = "content mount"
	kindArtifact       cloudMountKind = "artifact"
	kindKnowledgeGraph cloudMountKind = "knowledge-graph connection"
)

// cloudMount is one directory a disconnect removes, and the kind of marker that claimed it.
type cloudMount struct {
	Key  string         `json:"key"`
	Kind cloudMountKind `json:"kind"`
}

// cloudMounts names every module directory the console wrote as part of a cloud connection — the exact
// set removeCloudMounts then removes. Ownership is decided by marker file and by nothing else: a
// directory the console did not write is never a candidate, whatever it is called.
//
// A read failure yields nothing rather than an error, and the caller is the reason: a disconnect must
// still revert on a modules mount it cannot list. Leaving files behind is recoverable; refusing to
// disconnect is not.
func cloudMounts(modulesDir string) []cloudMount {
	entries, err := os.ReadDir(modulesDir)
	if err != nil {
		return nil
	}
	out := make([]cloudMount, 0, len(entries))
	for _, e := range entries {
		dir := filepath.Join(modulesDir, e.Name())
		// Lstat rather than the directory entry, for the reason removeArtifact gives at its own read:
		// with the key a symlink, a stat follows it and a marker planted behind it reads as ours, so the
		// rename below would move the link while the tree it names survived.
		info, statErr := os.Lstat(dir)
		if statErr != nil || !info.Mode().IsDir() {
			continue
		}
		var kinds []cloudMountKind
		if hasMarkerNamed(dir, mountMarkerName) {
			kinds = append(kinds, kindContentMount)
		}
		if hasMarkerNamed(dir, artifactMarkerName) {
			kinds = append(kinds, kindArtifact)
		}
		if hasMarkerNamed(dir, kgMarkerName) {
			kinds = append(kinds, kindKnowledgeGraph)
		}
		// Exactly one marker, or it is not this function's to name. NONE is a module the platform shipped
		// (it carries a payload stamp and no mount marker) or a directory the console never wrote — and a
		// disconnect that deleted either would be deleting something it does not own. MORE THAN ONE is
		// "claimed by two kinds at once, so claimed by neither", the rule listArtifacts already applies at
		// its own read; a disconnect is the wrong place to resolve an ambiguity nothing else resolves.
		if len(kinds) != 1 {
			continue
		}
		out = append(out, cloudMount{Key: e.Name(), Kind: kinds[0]})
	}
	// Sorted so the operator is told what went in a stable order rather than whichever order the
	// filesystem yielded.
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// mountKeys renders a set of mounts for the operator: the key and what kind it was, comma-separated in
// the order cloudMounts returned them. The kind is carried because a bare module key does not tell an
// operator whether they just lost an installed artifact or a catalog mount, and those cost very different
// amounts to put back.
func mountKeys(mounts []cloudMount) string {
	parts := make([]string, 0, len(mounts))
	for _, m := range mounts {
		parts = append(parts, m.Key+" ("+string(m.Kind)+")")
	}
	return strings.Join(parts, ", ")
}

// removeModuleTree takes one module directory out of the loader's way and then deletes the copy.
//
// THE RENAME IS THE ATOMIC POINT — after it, the module is gone from where the platform looks, whatever
// happens to the copy. os.RemoveAll gives no ordering guarantee, so "remove the marker last" is not
// implementable, and a half-deleted directory that still holds a loadable module file is the state this
// avoids. It is removeArtifact's sequence, extracted so the single removal and the disconnect sweep
// cannot drift apart.
//
// A FRESH destination every time: renaming onto a non-empty directory fails, and the one failure this is
// designed to survive — a staged copy that could not be deleted — leaves exactly such a directory behind.
// The key charset forbids dots, so the suffix cannot collide with another key's staging directory.
//
// It returns the staged path when the rename succeeded but the delete did not. The module IS gone in that
// case, so it is a warning and not a failure — but the path is named, because nothing else in the daemon
// clears this one.
func removeModuleTree(modulesDir, key string) (leftover string, err error) {
	// The escape check is HERE and not only at the callers. Both of today's callers already validate —
	// removeArtifact against moduleKeyPattern and moduleDir, the sweep by construction, since os.ReadDir
	// yields base names that cannot hold a separator — so this changes nothing today. It is here because
	// this function recursively deletes a directory it is handed the name of, and the next caller should
	// not have to be trusted to have checked. Safe by construction beats safe by discipline on a delete.
	dir, err := moduleDir(modulesDir, key)
	if err != nil {
		return "", err
	}
	staged := filepath.Join(modulesDir, moduleinstall.TmpDirName,
		key+".removing."+strconv.FormatInt(time.Now().UnixNano(), 36))
	if err := os.MkdirAll(filepath.Dir(staged), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(dir, staged); err != nil {
		return "", err
	}
	if err := os.RemoveAll(staged); err != nil {
		return staged, nil
	}
	_ = os.Remove(filepath.Dir(staged)) // only while empty, as everything else here leaves it
	return "", nil
}

// removeCloudMounts removes every directory cloudMounts names.
//
// BEST EFFORT, AND IT RETURNS NO ERROR ON PURPOSE. Its only caller is the disconnect, which is the
// recovery path — "a recovery path that something can block is not a recovery path", in the words the
// knowledge-graph unmount above it already carries. So a directory that cannot be removed is reported and
// stepped over; the revert always proceeds.
func (s *server) removeCloudMounts() (removed []cloudMount, failed []cloudMount, leftovers []string) {
	for _, m := range cloudMounts(s.cfg.ModulesDir) {
		leftover, err := removeModuleTree(s.cfg.ModulesDir, m.Key)
		if err != nil {
			s.logger.Error("removing a cloud module on disconnect", "module", m.Key, "kind", m.Kind, "err", err)
			failed = append(failed, m)
			continue
		}
		if leftover != "" {
			s.logger.Error("removing the staged copy of a cloud module", "module", m.Key, "path", leftover)
			leftovers = append(leftovers, leftover)
		}
		removed = append(removed, m)
	}
	return removed, failed, leftovers
}
