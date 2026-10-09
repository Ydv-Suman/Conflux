# Conflux Identity Service

Spring Boot service for Conflux authentication and team management. It will own users, teams, invitations, roles, capabilities, leadership, and chat data. The current repository is the initial service scaffold with Spring Security, OAuth2 client support, JPA, PostgreSQL, validation, web MVC, and Actuator.

## Requirements

- Java 25
- Docker

## PostgreSQL

Create and start the development database:

```bash
docker run --name conflux_identity \
  -e POSTGRES_PASSWORD=identity123 \
  -e POSTGRES_DB=identityDB \
  -p 5432:5432 \
  -v ~/Desktop/PROJECTS/pgdata:/var/lib/postgresql \
  -d postgres
```

For later sessions, start the existing container:

```bash
docker start conflux_identity
```

Check its status or logs:

```bash
docker ps --filter name=conflux_identity
docker logs conflux_identity
```

## Environment

Create the ignored local environment file from the committed template:

```bash
cd services/identity-service
mkdir -p secrets
cp .env.example secrets/.env
chmod 700 secrets
chmod 600 secrets/.env
```

Then edit `secrets/.env` with your local values:

```properties
DB_URL=jdbc:postgresql://localhost:5432/identityDB
DB_USERNAME=postgres
DB_PASSWORD=identity123

MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_USERNAME=your-brevo-smtp-login
MAIL_PASSWORD=your-brevo-smtp-key
MAIL_FROM=no-reply@your-verified-domain.com
APP_BASE_URL=http://localhost:5173
EMAIL_VERIFICATION_TTL=24h
JWT_ISSUER=http://localhost:8080
JWT_AUDIENCE=conflux-api
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
JWT_PUBLIC_KEY=file:./secrets/jwt-public.pem
JWT_PRIVATE_KEY=file:./secrets/jwt-private.pem
AUTH_SECURE_COOKIES=false
AUTH_COOKIE_SAME_SITE=Strict
CORS_ALLOWED_ORIGINS=http://localhost:5173
FORWARD_HEADERS_STRATEGY=none
GRPC_SERVER_PORT=9090
INTERNAL_GRPC_TOKEN=replace-with-at-least-32-random-characters
```

Use the SMTP login and SMTP key from Brevo, not the Brevo account password or API key.
The sender address or domain must be verified in Brevo.

The entire `secrets/` directory is ignored by Git. `application.yml` loads `secrets/.env` when the application starts from either the repository root or the service directory.

Generate the local RSA signing key pair (the ignored `secrets` directory must not be committed):

```bash
mkdir -p secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
chmod 600 secrets/jwt-private.pem
chmod 644 secrets/jwt-public.pem
```

Set `AUTH_SECURE_COOKIES=true` when the frontend uses HTTPS.
Keep `AUTH_COOKIE_SAME_SITE=Strict` for same-site clients. For a packaged desktop client calling a different HTTPS site, use `AUTH_COOKIE_SAME_SITE=None`; startup rejects that setting unless `AUTH_SECURE_COOKIES=true`.

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist. Use exact HTTPS origins in production; wildcard origins are rejected at startup. When the service runs directly, keep `FORWARD_HEADERS_STRATEGY=none`. Behind a trusted AWS ALB/reverse proxy, set `FORWARD_HEADERS_STRATEGY=native` so rate limiting uses the forwarded client address. Do not enable forwarded-header trust when clients can connect directly to the service and spoof proxy headers.

## AWS Secrets Manager (production)

The local `secrets/` directory is only for development. In production, store credentials and the JWT private key in AWS Secrets Manager and inject them at deployment time. Do not copy `secrets/` into the container image.

Recommended secret names:

```text
conflux/prod/identity-service/config
conflux/prod/identity-service/jwt-private-key
conflux/prod/identity-service/jwt-public-key
```

The `config` secret can contain sensitive application properties as JSON:

```json
{
  "DB_USERNAME": "identity_service",
  "DB_PASSWORD": "production-database-password",
  "MAIL_USERNAME": "smtp-login",
  "MAIL_PASSWORD": "smtp-password"
}
```

Store each JWT key as its complete PEM value, including the `BEGIN` and `END` lines. The private key is confidential; the public key can be distributed to services that validate tokens.

Keep non-secret configuration such as `DB_URL`, `APP_BASE_URL`, `JWT_ISSUER`, TTL values, and `AUTH_SECURE_COOKIES` in the deployment configuration rather than Secrets Manager.

### Recommended runtime layout

Mount JWT keys as read-only files and inject database/mail credentials as environment variables:

```text
/run/secrets/conflux/jwt-private.pem
/run/secrets/conflux/jwt-public.pem
```

Configure the production container with:

```properties
JWT_PRIVATE_KEY=file:/run/secrets/conflux/jwt-private.pem
JWT_PUBLIC_KEY=file:/run/secrets/conflux/jwt-public.pem
AUTH_SECURE_COOKIES=true
AUTH_COOKIE_SAME_SITE=None
CORS_ALLOWED_ORIGINS=https://app.conflux.example
FORWARD_HEADERS_STRATEGY=native
```

The existing `application.yml` and `JwtConfig` already support these file locations, so no Java change is required. The local `secrets/.env` file is not needed in production.

### EKS example

Use the AWS Secrets and Configuration Provider with the Secrets Store CSI Driver:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: identity-service-secrets
  namespace: conflux
spec:
  provider: aws
  parameters:
    region: us-east-1
    objects: |
      - objectName: "conflux/prod/identity-service/jwt-private-key"
        objectType: "secretsmanager"
        objectAlias: "jwt-private.pem"
        filePermission: "0400"
      - objectName: "conflux/prod/identity-service/jwt-public-key"
        objectType: "secretsmanager"
        objectAlias: "jwt-public.pem"
        filePermission: "0444"
```

Mount the resulting volume in the identity-service pod:

```yaml
containers:
  - name: identity-service
    env:
      - name: JWT_PRIVATE_KEY
        value: file:/run/secrets/conflux/jwt-private.pem
      - name: JWT_PUBLIC_KEY
        value: file:/run/secrets/conflux/jwt-public.pem
    volumeMounts:
      - name: aws-secrets
        mountPath: /run/secrets/conflux
        readOnly: true
volumes:
  - name: aws-secrets
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: identity-service-secrets
```

### ECS example

ECS can inject individual JSON fields from Secrets Manager as environment variables:

```json
{
  "secrets": [
    {
      "name": "DB_USERNAME",
      "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:conflux/prod/identity-service/config-AbCdEf:DB_USERNAME::"
    },
    {
      "name": "DB_PASSWORD",
      "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:conflux/prod/identity-service/config-AbCdEf:DB_PASSWORD::"
    },
    {
      "name": "MAIL_PASSWORD",
      "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:conflux/prod/identity-service/config-AbCdEf:MAIL_PASSWORD::"
    }
  ]
}
```

ECS environment variables are loaded when a task starts. After rotating a secret, start a new task or force a new service deployment. For PEM keys, prefer writing the secrets to a shared read-only volume instead of placing multiline keys in environment variables.

### IAM permissions

Give the EKS pod role or ECS task execution role access only to this service's secrets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadIdentityServiceSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:conflux/prod/identity-service/*"
    }
  ]
}
```

If the secrets use a customer-managed KMS key, also grant `kms:Decrypt` for that specific key. Use separate secret paths and IAM roles for development, staging, and production.

AWS references: [EKS Secrets Manager integration](https://docs.aws.amazon.com/eks/latest/userguide/manage-secrets.html), [ECS secret injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html), and [ECS sensitive-data guidance](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html).

## Authentication

- `POST /api/users` registers a local user and sends an email-verification message.
- `POST /api/users/verify-email` verifies an account using the emailed token.
- `POST /api/users/resend-verification` sends a new verification token when allowed by the rate limiter.
- `POST /api/auth/login` accepts `usernameOrEmail` and `password`, returns a 15-minute bearer token, and sets a rotating refresh-token cookie.
- `POST /api/auth/refresh` rotates the refresh cookie and returns a new bearer token.
- `POST /api/auth/logout` uses the refresh cookie, revokes the full login session, and clears the cookie even when the access token has expired.

Only email-verified users can log in. Expired revocations, sessions, verification tokens, and rate-limit events are removed hourly.
Five failed logins within five minutes trigger a fixed 60-second account cooldown; blocked retries do not extend it, and a successful login clears prior account failures. An IP may make 30 login attempts within five minutes.

## Current user

The current-user endpoints require an access token in the `Authorization: Bearer <token>` header. The service always takes the user ID from the validated JWT subject; clients cannot select another user by supplying an ID.

- `GET /api/users/me` returns the authenticated user's profile.
- `PUT /api/users/me` updates the authenticated user's name and username.
- `DELETE /api/users/me` permanently deletes the authenticated user's account. Database cascades remove credentials, verification tokens, external identities, and authentication sessions, so existing tokens can no longer be used.

Example update request:

```http
PUT /api/users/me
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "firstName": "Ada",
  "middleName": null,
  "lastName": "Lovelace",
  "username": "ada.lovelace"
}
```

The update endpoint intentionally does not change email addresses or passwords. Those operations require separate verification and credential-confirmation flows. User read, update, and delete operations use parameterized SQL queries through Spring `JdbcClient`.

The public endpoints are limited to `POST` requests for registration, email verification, login, refresh, and logout. All other routes require authentication by default.

## Internal gRPC authorization

Identity Service exposes an internal gRPC server on port `9090` by default. Its first versioned contract is defined in:

```text
src/main/proto/team_authorization.proto
```

The `conflux.identity.v1.TeamAuthorization/GetMembership` method accepts a user UUID and team UUID, then returns only:

- whether the user is currently a member
- the verified team role
- the capabilities derived by Identity Service

It does not return profile, email, credential, or session data. Non-members receive `is_member = false` with no role or capabilities.

Every gRPC request requires this metadata header:

```text
x-conflux-internal-token: <INTERNAL_GRPC_TOKEN>
```

The token must contain at least 32 characters, is compared in constant time, and is separate from user JWTs. Missing or invalid service credentials return `UNAUTHENTICATED`. Store the production value in the deployment secret manager and give it only to authorized internal callers.

The shared token protects application-level access but does not encrypt transport. Production deployment must place the gRPC port on a private network and enable TLS or mTLS before exposing it between hosts. Do not expose port `9090` through the public API gateway.

The gRPC server uses random ports during tests so parallel Spring test contexts cannot collide.

## Teams and capabilities

Team roles reuse the existing hierarchy: `ADMIN`, `TEAM_LEAD`, `SENIOR_DEVELOPER`, `DEVELOPER`, and `VIEWER`. Roles belong to a team membership rather than globally to a user. Authorization is based on centralized capabilities so business services do not duplicate role-name checks.

All team routes derive the acting user from the validated JWT subject:

- `POST /api/teams` creates a team and atomically assigns its creator as `ADMIN`.
- `GET /api/teams` lists only the authenticated user's teams.
- `GET /api/teams/{teamId}` returns a team only to one of its members.
- `GET /api/teams/{teamId}/members` lists members for an authorized team member.
- `POST /api/teams/{teamId}/members` adds a verified user by email when the actor can manage members.
- `PUT /api/teams/{teamId}/members/{memberId}/role` changes a role within the actor's authority.
- `DELETE /api/teams/{teamId}/members/{memberId}` removes a member within the actor's authority.
- `GET /api/teams/{teamId}/capabilities/me` returns the authenticated user's current team capabilities.

Membership mutations are rate-limited and audited. A `TEAM_LEAD` cannot assign or modify `ADMIN` or peer roles, and the final `ADMIN` cannot be removed, demoted, or delete their account until administration is transferred.

## Run

```bash
cd services/identity-service
./mvnw spring-boot:run
```

Spring Boot automatically imports `secrets/.env`; you do not need to run `source` or export each variable manually.

The service listens on `http://localhost:8080`.

## Test and build

The PostgreSQL container must be running because the context test connects to it.

```bash
cd services/identity-service
./mvnw test
./mvnw package
```

Run the optional dependency vulnerability scan in CI or before a release:

```bash
NVD_API_KEY=your-nvd-api-key ./mvnw verify -Psecurity-scan
```

The security profile uses OWASP Dependency-Check and fails the build for a dependency vulnerability with CVSS 7.0 or higher. The first database download can take several minutes; cache its data directory in CI. Keep `NVD_API_KEY` in the CI secret store, not in `.env.example` or Git.

The packaged application is written to `target/identity-service-0.0.1-SNAPSHOT.jar`.
