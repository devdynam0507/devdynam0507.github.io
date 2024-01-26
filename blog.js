const githubUserId = 'devdynam0507';
const blogRepositoryName = 'devdynam0507.github.io';

async function getPosts(rootTreeUrl) {
  return await fetch(rootTreeUrl)
    .then(res => res.json())
    .then(json => json.tree)
    .then(trees => trees.filter(tree => tree.type == 'blob'));
}

async function getRootDirectories(user, repo) {
  const url = `https://api.github.com/repos/${user}/${repo}/git/trees/main`;
  return await fetch(url)
    .then(res => res.json())
    .then(json => json.tree.filter(tree => tree.type === 'tree'));
}

document.addEventListener("DOMContentLoaded", async (event) => {
  const nav = document.getElementById("navbar");
  if (!nav) {
    return;
  }
  const directories = await getRootDirectories(githubUserId, blogRepositoryName);
  const postDirectory = directories.filter(dir => dir.path === 'posts');
  console.log(postDirectory);
  if (!postDirectory) {
    return;
  }
  const posts = await getPosts(postDirectory[0].url);
  localStorage.setItem(JSON.stringify(posts));
});