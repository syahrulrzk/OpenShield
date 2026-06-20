import { redirect } from "next/navigation";

export default function EventsRedirect() {
  // /dashboard/events → /dashboard/server (Server is the primary event type)
  redirect("/dashboard/server");
}
