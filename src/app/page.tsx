import { redirect } from "next/navigation";

// The proxy sends signed-out visitors to /login before this runs.
export default function RootPage() {
  redirect("/dashboard");
}
