import { prisma } from "@/lib/prisma"
import NewDiaryClient from "./new-diary-client"

export default async function NewDiaryPage({
  searchParams,
}: {
  searchParams: Promise<{ strain?: string }>
}) {
  const sp = await searchParams

  // ?strain=<strain id> pre-selects a catalog strain — resolved server-side
  // so a stale/invalid id degrades to a blank field instead of a broken link.
  const strainParam = typeof sp?.strain === "string" ? sp.strain.slice(0, 64) : null
  const strain = strainParam
    ? await prisma.strain.findUnique({
        where: { id: strainParam },
        select: { id: true, name: true },
      })
    : null

  return (
    <NewDiaryClient prefill={strain ? { strain: strain.name, strainId: strain.id } : null} />
  )
}
