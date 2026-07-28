import { render, screen } from "@testing-library/react";
import { FolderTree, Settings } from "lucide-react";
import { describe, expect, it } from "vitest";

import { MobileNavBar } from "@/components/ui/mobile-nav-bar";

const links = [
  { href: "/collections", label: "Collections", icon: FolderTree },
  { href: "/settings", label: "Settings", icon: Settings },
];

describe("MobileNavBar", () => {
  it("names every section accessibly and marks the active one, including nested routes", () => {
    render(<MobileNavBar links={links} activeHref="/collections/col-1" />);

    const active = screen.getByRole("link", { name: "Collections" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("carries the shell footer so account controls stay reachable on a phone", () => {
    render(
      <MobileNavBar
        links={links}
        activeHref="/collections"
        footer={<button type="button">Account</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
