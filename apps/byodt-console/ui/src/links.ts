// Outward links from the console. The BYODt portal origin is stable, so these are hardcoded rather
// than configured — a deployment never repoints them.
export const PORTAL_URL = 'https://byodt.dethernety.io'
export const GUIDE_URL = `${PORTAL_URL}/guide`
// The portal page that holds this deployment's login recipe (the values pasted into the Cloud panel).
export const DEPLOYMENT_URL = `${PORTAL_URL}/deployment`
// The portal catalog, where an operator subscribes to more content packages.
export const CATALOG_URL = `${PORTAL_URL}/catalog`

// The platform (the product) is served at the front-door root; the console sits under /console/ on
// the same origin, so a root-absolute link reaches it regardless of the console's base path.
export const PLATFORM_URL = '/'
