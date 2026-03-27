export * from "./schema.js";
export * from "./client.js";
export * from "./queries.js";
export * from "./config.js";
// embeddings exported separately via @wikibase/db/embeddings to avoid
// bundling @huggingface/transformers in web builds
// blockQueries exported separately via @wikibase/db/blocks for the same reason
