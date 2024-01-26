
export const component = (targetElementId, render) => {
  document.addEventListener("DOMContentLoaded", (_) => {
    const element = document.getElementById(targetElementId);
    if (element) {
      render(element);
    }
  })
};