package initcmd

import (
	"fmt"
	"strings"
)

// DefaultEmbeddingProfile is the profile the platform embeds with when EMBEDDING_MODEL is unset. It must equal the
// platform's DEFAULT_EMBEDDING_PROFILE_ID (apps/dt-ws/src/config/embedding-profile-selection.ts);
// embedding_test.go holds the two together.
const DefaultEmbeddingProfile = "embeddinggemma-300m-retrieval-v1"

// effectiveEmbeddingModel is the profile the platform runs for a raw EMBEDDING_MODEL: the trimmed value, or the
// default when it is unset or blank, as the platform reads it.
func effectiveEmbeddingModel(raw string) string {
	if model := strings.TrimSpace(raw); model != "" {
		return model
	}
	return DefaultEmbeddingProfile
}

// checkEmbeddingProfile refuses a platform model other than the one the bundled MITRE vectors were embedded with:
// the platform would search them with vectors from another model, which matches nothing reliably. The platform
// itself refuses models this release does not offer; this check runs first, so the refusal comes before the ingest.
func checkEmbeddingProfile(corpusProfile, rawModel string) error {
	model := effectiveEmbeddingModel(rawModel)
	if model == corpusProfile {
		return nil
	}
	if strings.TrimSpace(rawModel) == "" {
		// Nothing the operator set: the console and its data do not belong together.
		return fmt.Errorf("the platform's default embedding profile %q does not match this release's MITRE data, "+
			"which was embedded with %q: this console image is broken; report it", model, corpusProfile)
	}
	return fmt.Errorf("EMBEDDING_MODEL %q does not match this release's MITRE data, which was embedded with %q. "+
		"Remove EMBEDDING_MODEL from .env; the default is %s", model, corpusProfile, DefaultEmbeddingProfile)
}
