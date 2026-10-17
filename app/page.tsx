import { redirect } from "next/navigation";
import { getActiveProject } from "@/lib/projects";

// Start in the dashboard, or set up the first project if there isn't one yet.
export default async function Home() {
  redirect((await getActiveProject()) ? "/dashboard" : "/projects/new");
}
