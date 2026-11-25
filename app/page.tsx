import dynamic from "next/dynamic";

const PuzzleCam = dynamic(() => import("@/components/PuzzleCam"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#120b1f",
        color: "#a855f7",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      Memuat PuzzleCam…
    </div>
  ),
});

export default function Page() {
  return <PuzzleCam />;
}
