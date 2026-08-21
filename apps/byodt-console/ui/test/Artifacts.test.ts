import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Artifacts from '@/components/Artifacts.vue'
import {
  ApiError,
  clearCloudTokens,
  setCloudTokens,
  type CatalogArtifact,
  type CatalogPackage,
  type InstalledArtifact,
} from '@/api'

const installArtifact = vi.fn()
const removeArtifact = vi.fn()

// The spread is mandatory, not tidiness: ApiError and the token functions are the real ones, so
// `instanceof` still works in the refusal tests and cloudAccessToken reads the state these tests set.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    api: {
      installArtifact: (req: unknown) => installArtifact(req),
      removeArtifact: (key: string) => removeArtifact(key),
    },
  }
})

afterEach(() => {
  installArtifact.mockReset()
  removeArtifact.mockReset()
  clearCloudTokens()
})

const NOTICE = 'Removing this deletes the classes this module provides — and any it once provided.'

function artifact(over: Partial<CatalogArtifact> = {}): CatalogArtifact {
  return { key: 'acme-risk', name: 'Acme Risk', kind: 'code-module', latest: '1.3.0', ...over }
}

function pkg(over: Partial<CatalogPackage> = {}): CatalogPackage {
  return { key: 'acme-cloud', name: 'Acme Cloud', version: '1.0.0', modules: [], artifacts: [artifact()], ...over }
}

function installed(over: Partial<InstalledArtifact> = {}): InstalledArtifact {
  return { artifactKey: 'acme-risk', version: '1.2.0', kind: 'code-module', currency: 'outdated', latestVersion: '1.3.0', ...over }
}

function render(props: { packages?: CatalogPackage[]; installed?: InstalledArtifact[]; removalNotice?: string } = {}) {
  return mount(Artifacts, {
    props: {
      packages: props.packages ?? [pkg()],
      installed: props.installed ?? [],
      removalNotice: props.removalNotice ?? NOTICE,
    },
  })
}

// Signed in WITH tokens: the default for every test that expects a call to happen at all.
function signedIn() {
  setCloudTokens({ idToken: 'id', accessToken: 'acc' })
}

describe('Artifacts — what kind decides', () => {
  it('offers no Install control for an application, and a portal link instead', () => {
    // An application's whole point is that it is not installed here. This gate is the ONLY thing in the
    // SPA that says so, and until the daemon gained its own check it was the only thing anywhere.
    const w = render({ packages: [pkg({ artifacts: [artifact({ kind: 'application', target: 'acme-portal-app' })] })] })
    expect(w.find('[data-artifact-install]').exists()).toBe(false)
    expect(w.find('[data-artifact-version-input="acme-risk"]').exists()).toBe(false)
    expect(w.find('[data-artifact-portal-link]').exists()).toBe(true)
  })

  it('offers no Install control for an unknown kind, and still offers Remove', () => {
    // Reachable and not hypothetical: kind reaches the SPA only from the catalog, so an unreachable
    // catalog leaves it empty for something already installed. Treating empty as installable would put an
    // Install button on the one kind that is never installed here — and hiding Remove would take away the
    // operator's only remedy in exactly the state where they need it.
    const w = render({ packages: [], installed: [installed({ kind: '', currency: 'unknown' })] })
    expect(w.find('[data-artifact-install]').exists()).toBe(false)
    // The typed-version field is the half that matters here: the Install button is absent anyway when
    // there is no catalog to name a version, but this control needs none — so it is the one an empty kind
    // has to suppress on its own.
    expect(w.find('[data-artifact-version-input="acme-risk"]').exists()).toBe(false)
    expect(w.find('[data-artifact-installable="false"]').exists()).toBe(true)
    expect(w.find('[data-artifact-remove]').exists()).toBe(true)
  })

  it('renders an installed artifact with no catalog at all', () => {
    // The parent empties its package list when the catalog fails, so rows built from the catalog alone
    // would take an installed artifact — and its Remove control — off the screen.
    const w = render({ packages: [], installed: [installed()] })
    expect(w.findAll('[data-artifact-row]')).toHaveLength(1)
    expect(w.text()).toContain('1.2.0')
    expect(w.find('[data-artifact-remove]').exists()).toBe(true)
  })
})

describe('Artifacts — one row per artifact', () => {
  it('renders one row for an artifact three packages grant, entitled if any of them is', () => {
    const w = render({
      packages: [
        pkg({ key: 'a', entitled: false }),
        pkg({ key: 'b', entitled: true }),
        pkg({ key: 'c', entitled: undefined }),
      ],
    })
    expect(w.findAll('[data-artifact-row]')).toHaveLength(1)
    expect(w.text()).not.toContain('Not subscribed')
    expect(w.find('[data-artifact-install]').exists()).toBe(true)
  })

  it('is not subscribed only when no granting package is entitled, and undetermined never gates', () => {
    const notSubscribed = render({ packages: [pkg({ key: 'a', entitled: false }), pkg({ key: 'b', entitled: false })] })
    expect(notSubscribed.text()).toContain('Not subscribed')
    expect(notSubscribed.find('[data-artifact-install]').exists()).toBe(false)

    // Undetermined (a recipe predating the entitlement variable) must never gate.
    const undetermined = render({ packages: [pkg({ key: 'a', entitled: undefined })] })
    expect(undetermined.text()).not.toContain('Not subscribed')
    expect(undetermined.find('[data-artifact-install]').exists()).toBe(true)
  })

  it('resolves latest across packages the way the daemon does', () => {
    // The case a string comparison inverts, on the value the Install button actually sends.
    const tens = render({
      packages: [pkg({ key: 'a', artifacts: [artifact({ latest: '1.9.0' })] }), pkg({ key: 'b', artifacts: [artifact({ latest: '1.10.0' })] })],
    })
    expect(tens.get('[data-artifact-install]').text()).toContain('1.10.0')

    // Order must not decide it.
    const reversed = render({
      packages: [pkg({ key: 'b', artifacts: [artifact({ latest: '1.10.0' })] }), pkg({ key: 'a', artifacts: [artifact({ latest: '1.9.0' })] })],
    })
    expect(reversed.get('[data-artifact-install]').text()).toContain('1.10.0')

    // A readable latest beats an unreadable one, which beats an absent one — the daemon's own total order.
    const mixed = render({
      packages: [
        pkg({ key: 'a', artifacts: [artifact({ latest: undefined })] }),
        pkg({ key: 'b', artifacts: [artifact({ latest: 'banana' })] }),
        pkg({ key: 'c', artifacts: [artifact({ latest: '2.0.0' })] }),
      ],
    })
    expect(mixed.get('[data-artifact-install]').text()).toContain('2.0.0')

    // The whole entry travels with the winner, so the name comes from the package that won.
    const named = render({
      packages: [
        pkg({ key: 'a', artifacts: [artifact({ latest: '1.0.0', name: 'Older' })] }),
        pkg({ key: 'b', artifacts: [artifact({ latest: '2.0.0', name: 'Newer' })] }),
      ],
    })
    expect(named.text()).toContain('Newer')
  })

  it('offers nothing to install when latest is unreadable or every version was withdrawn', () => {
    // latest is a catalog string the operator never typed, and the fold propagates an unreadable one
    // deliberately — so it takes the same validation the typed field does.
    const unreadable = render({ packages: [pkg({ artifacts: [artifact({ latest: '1.2' })] })] })
    expect(unreadable.find('[data-artifact-install]').exists()).toBe(false)

    const withdrawn = render({
      packages: [pkg({ artifacts: [artifact({ latest: undefined })] })],
      installed: [installed({ currency: 'unavailable' })],
    })
    expect(withdrawn.find('[data-artifact-install]').exists()).toBe(false)
    expect(withdrawn.text()).toContain('no longer published')
  })
})

describe('Artifacts — what is worth offering', () => {
  it('calls an identical version a Reinstall, not an Update', () => {
    // The steady state of every healthy deployment. The button worked — re-installing the same version is
    // the documented repair path and the daemon allows it — but "Update 1.3.0" sat beside a chip reading
    // "up to date", which is the panel disagreeing with itself.
    const w = render({ installed: [installed({ version: '1.3.0', currency: 'current' })] })
    const btn = w.get('[data-artifact-install]')
    expect(btn.text()).toContain('Reinstall')
    expect(btn.text()).toContain('1.3.0')
    expect(btn.text()).not.toContain('Update')
  })

  it('offers nothing when the installed version is newer than the catalog knows about', () => {
    // artifactCurrency answers `unknown` here rather than `outdated`, and withholds latestVersion,
    // precisely so nothing prompts a move backwards — and the panel rebuilt the prompt from the raw
    // catalog entry, producing a control the daemon could only answer 409 to.
    const w = render({
      packages: [pkg({ artifacts: [artifact({ latest: '1.3.0' })] })],
      installed: [installed({ version: '1.4.0', currency: 'unknown', latestVersion: '' })],
    })
    expect(w.find('[data-artifact-install]').exists()).toBe(false)
    // The typed-version control stays: typing it is how the operator asks for the downgrade explicitly,
    // which is the whole point of the daemon requiring them to ask.
    expect(w.find('[data-artifact-install-typed]').exists()).toBe(true)
    expect(w.find('[data-artifact-remove]').exists()).toBe(true)
  })

  it('offers nothing over an installed version it cannot read', () => {
    const w = render({ installed: [installed({ version: 'banana', currency: 'unknown' })] })
    expect(w.find('[data-artifact-install]').exists()).toBe(false)
  })
})

describe('Artifacts — the two empty-token states', () => {
  it('shows the reconnect remedy, rather than a sign-in loop, when only the access token is missing', async () => {
    // api.ts enumerates two empty-token states with opposite remedies and says telling them apart is the
    // difference between a recovery and a loop. Signing in again returns the same empty token forever, so
    // a redirect here would be the loop — and the operator would never learn why.
    setCloudTokens({ idToken: 'id', accessToken: '' })
    const w = render()
    await w.get('[data-artifact-install]').trigger('click')
    await flushPromises()
    expect(installArtifact).not.toHaveBeenCalled()
    expect(w.emitted('sign-in-required')).toBeUndefined()
    expect(w.get('[data-artifact-message]').text()).toContain('Regenerate the deployment recipe')
  })

  it('closes the downgrade confirm when it takes that branch', async () => {
    // install() is reachable from the confirm, and only run() clears `pending` — so an early return that
    // skips run() leaves the accept card open above a sentence about something else entirely.
    setCloudTokens({ idToken: 'id', accessToken: '' })
    const w = render({ installed: [installed({ version: '1.3.0' })] })
    await w.get('[data-artifact-version-input="acme-risk"]').setValue('1.1.0')
    await w.get('[data-artifact-install-typed]').trigger('click')
    expect(w.find('[data-artifact-downgrade-confirm]').exists()).toBe(true)

    await w.get('[data-artifact-downgrade-accept]').trigger('click')
    await flushPromises()
    expect(installArtifact).not.toHaveBeenCalled()
    expect(w.find('[data-artifact-downgrade-confirm]').exists()).toBe(false)
    expect(w.get('[data-artifact-message]').text()).toContain('Regenerate the deployment recipe')
  })
})

describe('Artifacts — the downgrade confirm', () => {
  it('confirms a downgrade, naming both versions, and sends the flag only when accepted', async () => {
    signedIn()
    installArtifact.mockResolvedValue({ status: 'installed', artifactKey: 'acme-risk', version: '1.1.0', message: 'artifact installed' })
    const w = render({ installed: [installed({ version: '1.3.0', currency: 'current' })] })

    await w.get('[data-artifact-version-input="acme-risk"]').setValue('1.1.0')
    await w.get('[data-artifact-install-typed]').trigger('click')
    await flushPromises()

    // Nothing is sent until the operator has seen both versions and accepted.
    expect(installArtifact).not.toHaveBeenCalled()
    const confirm = w.get('[data-artifact-downgrade-confirm]')
    expect(confirm.text()).toContain('1.1.0')
    expect(confirm.text()).toContain('1.3.0')

    await w.get('[data-artifact-downgrade-accept]').trigger('click')
    await flushPromises()
    expect(installArtifact).toHaveBeenCalledWith({ artifactKey: 'acme-risk', version: '1.1.0', allowDowngrade: true })
  })

  it('sends nothing when the downgrade is declined', async () => {
    signedIn()
    const w = render({ installed: [installed({ version: '1.3.0' })] })
    await w.get('[data-artifact-version-input="acme-risk"]').setValue('1.1.0')
    await w.get('[data-artifact-install-typed]').trigger('click')
    await w.get('[data-artifact-downgrade-cancel]').trigger('click')
    await flushPromises()
    expect(installArtifact).not.toHaveBeenCalled()
    expect(w.find('[data-artifact-downgrade-confirm]').exists()).toBe(false)
  })

  it('never sends the flag when it is not a downgrade', async () => {
    // allowDowngrade is the one input that turns the daemon's guard off, so attaching it to every typed
    // install would disable the check that stops a withdrawn version walking this deployment backwards.
    signedIn()
    installArtifact.mockResolvedValue({ status: 'installed', artifactKey: 'acme-risk', version: 'x', message: 'ok' })

    // Equal — the documented repair path, and not a downgrade.
    const same = render({ installed: [installed({ version: '1.2.0' })] })
    await same.get('[data-artifact-version-input="acme-risk"]').setValue('1.2.0')
    await same.get('[data-artifact-install-typed]').trigger('click')
    await flushPromises()
    expect(same.find('[data-artifact-downgrade-confirm]').exists()).toBe(false)
    expect(installArtifact).toHaveBeenLastCalledWith({ artifactKey: 'acme-risk', version: '1.2.0' })

    // Higher.
    const up = render({ installed: [installed({ version: '1.2.0' })] })
    await up.get('[data-artifact-version-input="acme-risk"]').setValue('1.4.0')
    await up.get('[data-artifact-install-typed]').trigger('click')
    await flushPromises()
    expect(installArtifact).toHaveBeenLastCalledWith({ artifactKey: 'acme-risk', version: '1.4.0' })

    // An installed version the console cannot read: no confirm, no flag — the daemon refuses on its own
    // terms, which is the true thing to tell the operator.
    const unreadable = render({ installed: [installed({ version: 'banana', currency: 'unknown' })] })
    await unreadable.get('[data-artifact-version-input="acme-risk"]').setValue('1.1.0')
    await unreadable.get('[data-artifact-install-typed]').trigger('click')
    await flushPromises()
    expect(unreadable.find('[data-artifact-downgrade-confirm]').exists()).toBe(false)
    expect(installArtifact).toHaveBeenLastCalledWith({ artifactKey: 'acme-risk', version: '1.1.0' })
  })

  it('refuses a badly shaped version before it reaches the daemon', async () => {
    signedIn()
    const w = render()
    for (const bad of ['1.2', '01.2.0', '1.2.3-rc.1', 'latest', '']) {
      await w.get('[data-artifact-version-input="acme-risk"]').setValue(bad)
      await w.get('[data-artifact-install-typed]').trigger('click')
      await flushPromises()
    }
    expect(installArtifact).not.toHaveBeenCalled()
    expect(w.get('[data-artifact-message]').text()).toContain('MAJOR.MINOR.PATCH')
  })
})

describe('Artifacts — refusals and removal', () => {
  it('surfaces the daemon withdrawal sentence unchanged', async () => {
    // The daemon composes the publisher's reason and the superseding version into one sentence; the SPA
    // shows what it is given rather than reassembling anything.
    signedIn()
    installArtifact.mockRejectedValue(
      new ApiError(410, 'this version has been withdrawn: a defect in the scoring rules — superseded by 1.3.1'),
    )
    const w = render()
    await w.get('[data-artifact-install]').trigger('click')
    await flushPromises()
    const shown = w.get('[data-artifact-message]').text()
    expect(shown).toContain('a defect in the scoring rules')
    expect(shown).toContain('superseded by 1.3.1')
  })

  it('asks for a sign-in instead of sending a request it has no token for', async () => {
    // A reloaded tab is signed in with a live session and no tokens at all, which is exactly the state the
    // restart prompt invites. The signed-in chrome carries no sign-in control, so the panel offers one.
    const w = render()
    await w.get('[data-artifact-install]').trigger('click')
    await flushPromises()
    expect(installArtifact).not.toHaveBeenCalled()
    expect(w.emitted('sign-in-required')).toHaveLength(1)
  })

  it('says what removal does to the graph before it does it', async () => {
    signedIn()
    removeArtifact.mockResolvedValue({
      status: 'removed',
      artifactKey: 'acme-risk',
      message: 'artifact removed; apply it by recreating the stack: byodt restart platform',
      consequence: NOTICE,
    })
    const w = render({ installed: [installed()] })

    await w.get('[data-artifact-remove]').trigger('click')
    await flushPromises()
    // Named before the confirm, not after — afterwards it is no longer a decision.
    expect(removeArtifact).not.toHaveBeenCalled()
    expect(w.get('[data-artifact-remove-consequence]').text()).toContain('deletes the classes')

    await w.get('[data-artifact-remove-cancel]').trigger('click')
    await flushPromises()
    expect(removeArtifact).not.toHaveBeenCalled()

    await w.get('[data-artifact-remove]').trigger('click')
    await w.get('[data-artifact-remove-accept]').trigger('click')
    await flushPromises()
    expect(removeArtifact).toHaveBeenCalledWith('acme-risk')
    expect(w.emitted('changed')).toHaveLength(1)
    expect(w.get('[data-artifact-message]').text()).toContain('byodt restart platform')
  })
})
