import { bootstrapApplication } from "@angular/platform-browser";
import { Component } from "@angular/core";

@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <main style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: system-ui">
      <h1>Hello from Angular!</h1>
    </main>
  `,
})
export class AppComponent {}

bootstrapApplication(AppComponent);
