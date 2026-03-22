import { spawnSync } from "child_process";

const CONTAINER_NAME = "ai-wiki-postgres";
const VOLUME_NAME = "ai-wiki-postgres-data";
const DB_URL = "postgresql://aiwiki:aiwiki@127.0.0.1:5499/aiwiki";

export { DB_URL as DOCKER_DB_URL };

/**
 * Returns true if the Docker daemon is reachable.
 * Uses `docker info` which exits non-zero when Docker is not running.
 */
export function isDockerAvailable(): boolean {
  try {
    const result = spawnSync("docker", ["info"], { stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Returns true if the ai-wiki-postgres container exists (running or stopped).
 */
function containerExists(): boolean {
  try {
    const result = spawnSync(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `name=^${CONTAINER_NAME}$`,
        "--format",
        "{{.Names}}",
      ],
      { stdio: "pipe" }
    );
    return (result.stdout?.toString() ?? "").trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

/**
 * Returns true if the ai-wiki-postgres container is currently running.
 */
function containerRunning(): boolean {
  try {
    const result = spawnSync(
      "docker",
      [
        "ps",
        "--filter",
        `name=^${CONTAINER_NAME}$`,
        "--format",
        "{{.Names}}",
      ],
      { stdio: "pipe" }
    );
    return (result.stdout?.toString() ?? "").trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}

/**
 * Ensures the ai-wiki-postgres Docker container is running and Postgres is
 * accepting connections. Creates the container on first run using a named
 * volume for data persistence.
 *
 * @returns The DATABASE_URL for the local container.
 * @throws If Docker is unavailable, container start/create fails, or Postgres
 *         does not become ready within 15 seconds.
 */
export async function startDockerPostgres(): Promise<string> {
  if (!isDockerAvailable()) {
    throw new Error(
      "Docker is not running or not installed. Start Docker Desktop and try again."
    );
  }

  if (containerRunning()) {
    console.log(`  Container "${CONTAINER_NAME}" is already running.`);
    return DB_URL;
  }

  if (containerExists()) {
    console.log(`  Starting existing container "${CONTAINER_NAME}"...`);
    const start = spawnSync("docker", ["start", CONTAINER_NAME], {
      stdio: "pipe",
    });
    if (start.status !== 0) {
      throw new Error(
        `Failed to start container: ${start.stderr?.toString()}`
      );
    }
  } else {
    console.log(`  Creating container "${CONTAINER_NAME}"...`);
    const run = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        CONTAINER_NAME,
        "-e",
        "POSTGRES_USER=aiwiki",
        "-e",
        "POSTGRES_PASSWORD=aiwiki",
        "-e",
        "POSTGRES_DB=aiwiki",
        "-p",
        "5499:5432",
        "-v",
        `${VOLUME_NAME}:/var/lib/postgresql/data`,
        "pgvector/pgvector:pg16",
      ],
      { stdio: "pipe" }
    );
    if (run.status !== 0) {
      throw new Error(
        `Failed to create container: ${run.stderr?.toString()}`
      );
    }
  }

  // Poll pg_isready up to 15 seconds before giving up
  process.stdout.write("  Waiting for Postgres to be ready");
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write(".");
    try {
      const ready = spawnSync(
        "docker",
        ["exec", CONTAINER_NAME, "pg_isready", "-U", "aiwiki"],
        { stdio: "pipe" }
      );
      if (ready.status === 0) {
        process.stdout.write(" ready.\n");
        return DB_URL;
      }
    } catch {
      /* keep polling */
    }
  }

  throw new Error(
    "Postgres did not become ready in time. Check `docker logs ai-wiki-postgres`."
  );
}
