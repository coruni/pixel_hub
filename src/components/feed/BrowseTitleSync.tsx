"use client";

import { useEffect } from "react";

export default function BrowseTitleSync({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
