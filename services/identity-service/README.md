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

Create `services/identity-service/.env`:

```properties
DB_URL=jdbc:postgresql://localhost:5432/identityDB
DB_USERNAME=postgres
DB_PASSWORD=identity123

MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_USERNAME=your-brevo-smtp-login
MAIL_PASSWORD=your-brevo-smtp-key
MAIL_FROM=no-reply@your-verified-domain.com
APP_BASE_URL=http://localhost:3000
EMAIL_VERIFICATION_TTL=24h
```

Use the SMTP login and SMTP key from Brevo, not the Brevo account password or API key.
The sender address or domain must be verified in Brevo.

The file is ignored by Git. `application.yml` loads it when the app starts from either the repository root or the service directory.

## Run

```bash
cd services/identity-service
./mvnw spring-boot:run
```

The service listens on `http://localhost:8080`.

## Test and build

The PostgreSQL container must be running because the context test connects to it.

```bash
cd services/identity-service
./mvnw test
./mvnw package
```

The packaged application is written to `target/identity-service-0.0.1-SNAPSHOT.jar`.
