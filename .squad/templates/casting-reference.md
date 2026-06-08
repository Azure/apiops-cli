# Casting Reference

On-demand reference for Squad's casting system. Loaded during Init Mode or when adding team members.

## Universe Table

| Universe | Capacity | Shape Tags | Resonance Signals |
|---|---|---|---|
| custom | 25 | role-based, deterministic | none (fixed custom policy) |

**Total: 1 universe** — custom-only policy.

## Selection Algorithm

Universe selection is fixed by policy:

1. Read `.squad/casting/policy.json`.
2. Use the only allowed universe: `custom`.
3. Assign descriptive role-based names according to team configuration.

No scoring or LRU selection is applied when policy is custom-only.

## Casting State File Schemas

### policy.json

Source template: `.squad/templates/casting-policy.json`
Runtime location: `.squad/casting/policy.json`

```json
{
  "casting_policy_version": "1.1",
  "allowlist_universes": ["custom"],
  "universe_capacity": {
    "custom": 25
  },
  "custom_universe_note": "This project uses descriptive role-based agent names instead of fictional universe characters."
}
```

### registry.json

Source template: `.squad/templates/casting-registry.json`
Runtime location: `.squad/casting/registry.json`

```json
{
  "agents": {
    "agent-role-id": {
      "persistent_name": "RoleName",
      "universe": "custom",
      "created_at": "ISO-8601",
      "legacy_named": false,
      "status": "active"
    }
  }
}
```

### history.json

Source template: `.squad/templates/casting-history.json`
Runtime location: `.squad/casting/history.json`

```json
{
  "universe_usage_history": [
    {
      "universe": "custom",
      "assignment_id": "unique-id",
      "used_at": "ISO-8601"
    }
  ],
  "assignment_cast_snapshots": {
    "assignment-id": {
      "universe": "custom",
      "agents": {
        "role-id": "RoleName"
      },
      "created_at": "ISO-8601"
    }
  }
}
```
