import { listEntries } from "@ai-wiki/db";
import { EntryList } from "./components/EntryList";

export default async function HomePage() {
  const entries = await listEntries(1000);
  return (
    <main>
      <EntryList entries={entries} />
    </main>
  );
}
