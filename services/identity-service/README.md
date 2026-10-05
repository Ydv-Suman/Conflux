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

- `POST /api/auth/login` accepts `usernameOrEmail` and `password`, returns a 15-minute bearer token, and sets a rotating refresh-token cookie.
- `POST /api/auth/refresh` rotates the refresh cookie and returns a new bearer token.
- `POST /api/auth/logout` uses the refresh cookie, revokes the full login session, and clears the cookie even when the access token has expired.

Only email-verified users can log in. Expired revocations, sessions, verification tokens, and rate-limit events are removed hourly.
Five failed logins within five minutes trigger a fixed 60-second account cooldown; blocked retries do not extend it, and a successful login clears prior account failures. An IP may make 30 login attempts within five minutes.

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
