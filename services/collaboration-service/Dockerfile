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

ENV JAVA_TOOL_OPTIONS="-Xms256m -Xmx512m -Djava.io.tmpdir=/tmp"
ENV COLLABORATION_DATA_DIR=/app/documents
USER conflux
EXPOSE 8090
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
