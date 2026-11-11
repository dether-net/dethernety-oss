### Contradictory pairs

After each batch, check that every pair describing one property agrees:

| Template field (boolean) | Floor field (string) | Agreement |
|---|---|---|
| `encrypted_at_rest`, `storage_encrypted` | `encryption_at_rest` | `false` ↔ `"none"`; `true` ↔ the observed algorithm, or `"encrypted (algorithm not observed)"` |
| `tls_enabled`, `ssl_enabled`, `https_only`, `flow_tls_encrypted`, `encryption_in_transit_enabled`, `data_tier_transit_encrypted`, `registry_pull_over_tls` | `encryption_in_transit` | `false` ↔ `"none"`; `true` ↔ the observed protocol and version, or `"TLS"` |
| `tls_only_transport`, `service_to_service_mtls_enforced` | `encryption_in_transit` | `true` ↔ the observed protocol, or `"TLS"`; `false` says nothing about it |
| `auth_required`, `authentication_enabled` | `authentication_type` | `false` ↔ `"none"`; `true` ↔ the observed mechanism |

Gate 3's C8 and the quality score read only the floor field. Whenever a template field in this table is written — by the enrichment agent, by the {{agent:enrichment-applier}} agent after the relay, or by the enrich skill after `claim-confirm` or a question — and its floor field is `null`, write the floor field beside it in the same write, as the Agreement column says, from the same evidence or answer. A floor field that already holds a differing value is a divergence row: write neither side. The evidence decides both fields. If it settles neither, both stay `null` and the pair goes to the top of the divergence table. The validator reports a pair that disagrees as `contradictory_fields`, a value outside the class template's schema as `value_off_schema`, an `auth_failure_mode` on a flow without authentication as `auth_failure_mode_without_auth`, and a word mixing Latin letters with Cyrillic or Greek look-alikes as `mixed_script_value` (retype it in one script from what the source shows): settle each before the batch closes. The same holds for any other template field that restates a floor key.
