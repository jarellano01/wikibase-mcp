import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth();

export async function embedText(
  text: string,
  projectId: string,
  location: string,
): Promise<number[]> {
  const client = await auth.getClient();
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/text-embedding-005:predict`;

  const response = await client.request<{
    predictions: Array<{ embeddings: { values: number[] } }>;
  }>({
    url,
    method: "POST",
    data: {
      instances: [{ content: text }],
    },
  });

  return response.data.predictions[0].embeddings.values;
}
