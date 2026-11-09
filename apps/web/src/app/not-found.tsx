import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">This page does not exist.</p>
      <Link href="/dashboard" className="mt-4 text-sm font-medium text-primary hover:underline">Go to the dashboard</Link>
    </main>
  );
}
