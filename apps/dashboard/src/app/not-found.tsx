import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="standalone">
      <div className="standalone__card">
        <Brand />
        <div className="standalone__heading">
          <h1>Page not found</h1>
          <p>The page doesn’t exist, or your account doesn’t have access to it.</p>
        </div>
        <Link className="button button--primary" href="/overview">
          Go to overview
        </Link>
      </div>
    </main>
  );
}
