FROM node:22-bookworm-slim AS validator
WORKDIR /validator
COPY validator/package.json validator/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY validator/validate.mjs validator/worker.mjs ./

FROM eclipse-temurin:25-jdk-noble AS build

WORKDIR /conflux
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -q -DskipTests dependency:go-offline
COPY src src
RUN ./mvnw -q -DskipTests package

FROM eclipse-temurin:25-jre-noble

RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin conflux \
    && install -d -m 0700 -o conflux -g conflux /app/documents
WORKDIR /app
COPY --from=build --chmod=0444 /conflux/target/collaboration-service-*.jar app.jar
COPY --from=validator /usr/local/bin/node /usr/local/bin/node
COPY --from=validator /validator /app/validator

ENV JAVA_TOOL_OPTIONS="-Xms256m -Xmx512m -Djava.io.tmpdir=/tmp"
ENV COLLABORATION_DATA_DIR=/app/documents
USER conflux
EXPOSE 8090
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
