import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[80dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface-2">
        <Compass className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">This page doesn&apos;t exist. If you were joining a room, check the code or link.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/join" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-ink">
          Enter a code
        </Link>
        <Link href="/" className="inline-flex h-11 items-center rounded-xl border border-line-strong px-5 font-semibold">
          Home
        </Link>
      </div>
    </main>
  );
}
