import { redirect } from "next/navigation"

// The /digest chat command summarizes the last 24 hours of PUBLIC
// activity in-room; the weekly in-app digest lives at /mydigest.
export default function DigestPage() {
  redirect("/mydigest")
}
