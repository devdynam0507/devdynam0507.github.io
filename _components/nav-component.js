import { component } from "./component";

component(element => {
  element.innerHTML = `
    <nav id="navbar" class="bg-white flex items-center space-x-4 flex-row p-4 border-b-gray-200 border-b">
      <p class="text-lg font-semibold text-black">감자맨</p>
      <a href="./about.html" class="text-sm text-gray">About</a>
    </nav>
  `;
});
