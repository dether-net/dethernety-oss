# Database maintenance

For the on-call engineer. The orders database has no public address; all manual access goes through the
ops bastion.

## The ops bastion

- Host: `ops-bastion.orderdesk.example`, a single Ubuntu 22.04 LTS instance in the operations subnet
  (`10.20.9.0/28`).
- Its security group accepts port 22 from `0.0.0.0/0`, so on-call engineers can connect from anywhere.
  It allows no other inbound port.
- Its outbound rules allow all traffic: from the bastion you can reach every host in the VPC.
- Everyone signs in as the shared `ops` account with their own key in `~ops/.ssh/authorized_keys`; the
  account has passwordless sudo. The image's default user is removed.
- fail2ban bans an address for one hour after five failed logins.
- Interactive shells end after 15 idle minutes: `TMOUT=900` is set in `/etc/profile.d/timeout.sh`.
- The `ops` account is capped at four concurrent logins: `ops hard maxlogins 4` in
  `/etc/security/limits.conf`.
- `auth.log` is forwarded over HTTPS to the log platform (`ingest.logplatform.example`) with the
  platform's key for the bastion.

The SSH daemon settings on the bastion:

```text
PermitRootLogin no
PasswordAuthentication no
AuthenticationMethods publickey
MaxAuthTries 3
MaxSessions 2
ClientAliveInterval 300
ClientAliveCountMax 2
KexAlgorithms curve25519-sha256
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com
```

## Opening a database session

1. Open a tunnel through the bastion:

   ```sh
   ssh -L 6432:orders-db.internal.orderdesk.example:5432 ops@ops-bastion.orderdesk.example
   ```

2. Connect as the admin role. The password is in the team password manager:

   ```sh
   psql "host=localhost port=6432 dbname=orders user=orders_admin sslmode=require"
   ```

## Replaying a payment event

When a payment event was lost, ask the payment vendor to send it again through the orders API's admin
listener. From the bastion:

```sh
curl -X POST http://orders-api-admin.orders.internal.orderdesk.example:9090/admin/replay-webhook/evt_0123456789
```

## Refreshing table statistics

```sh
curl -X POST http://orders-api-admin.orders.internal.orderdesk.example:9090/admin/reindex/orders
```
