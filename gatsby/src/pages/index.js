import * as React from "react";

export default function IndexPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontFamily: "system-ui" }}>
      <h1>Hello from Gatsby!</h1>
    </main>
  );
}

export const Head = () => <title>Hello Gatsby</title>;
