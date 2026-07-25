// Zorecho UI kit — render smoke tests. Guards against the "untested component
// ships a bad import" trap and pins the honest status vocabulary.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Button,
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Badge,
  StatusDot,
  STATUS_META,
  AgentCard,
  BarsLoader,
  ZorechoCore,
  Toast,
} from "./index.js";

describe("Zorecho UI kit", () => {
  it("renders Button variants and disables while loading", () => {
    const { rerender } = render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
    rerender(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });

  it("renders Card with header, body and accent", () => {
    render(
      <Card accent="#14B8A6">
        <CardHeader title="Executive roster" subtitle="Live" />
        <CardBody>content</CardBody>
      </Card>
    );
    expect(screen.getByText("Executive roster")).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders Field + Input with an error message", () => {
    render(
      <Field label="Email" error="Already used" htmlFor="e">
        <Input id="e" error />
      </Field>
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByText("Already used")).toBeInTheDocument();
  });

  it("Badge supports tones and agent colors", () => {
    render(
      <>
        <Badge tone="warn">Needs attention</Badge>
        <Badge color="#EC4899">Nova</Badge>
      </>
    );
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
  });

  it("StatusDot uses only the approved honest labels", () => {
    expect(Object.values(STATUS_META).map((m) => m.label)).toEqual([
      "Running",
      "Waiting",
      "Paused",
      "Needs Connection",
      "Disabled",
      "Attention Required",
    ]);
    render(<StatusDot status="needs_connection" />);
    expect(screen.getByText("Needs Connection")).toBeInTheDocument();
  });

  it("AgentCard shows name, title and honest status when no real activity", () => {
    render(
      <AgentCard
        agent={{ id: "echo", name: "Echo", title: "Marketing Director", color: "#14B8A6" }}
        status="waiting"
        activity={null}
        onClick={() => {}}
      />
    );
    expect(screen.getByText("Echo")).toBeInTheDocument();
    expect(screen.getByText("Marketing Director")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
  });

  it("ZorechoCore renders every state and health without crashing", () => {
    for (const state of ["idle", "listening", "thinking", "speaking"]) {
      for (const health of ["ok", "warn", "critical"]) {
        const { unmount } = render(
          <ZorechoCore state={state} health={health} pulse={{ color: "#F97316", key: 1 }} />
        );
        expect(
          screen.getByRole("img", { name: /zorecho core/i })
        ).toBeInTheDocument();
        unmount();
      }
    }
  });

  it("BarsLoader exposes a loading role with label", () => {
    render(<BarsLoader label="Loading leads…" />);
    expect(screen.getByRole("status", { name: "Loading leads…" })).toBeInTheDocument();
  });

  it("Toast renders title, message and agent badge", () => {
    render(
      <Toast
        title="Pulse finished a task"
        message="Booked an appointment."
        agent={{ name: "Pulse", color: "#F97316" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Pulse finished a task")).toBeInTheDocument();
    expect(screen.getByText("Pulse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });
});
