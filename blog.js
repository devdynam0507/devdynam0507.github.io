const githubUserId = 'devdynam0507';
const blogRepositoryName = 'devdynam0507.github.io';

async function getPosts(user, repo, directory) {
  const url = `https://api.github.com/repos/${user}/${repo}/git/trees/main`;
  const list = await fetch(url).then(res => res.json());
  const dir = list.tree.find(node => node.path === directory);
  if (dir) {
     const list = await fetch(dir.url).then(res => res.json());
     return list.tree.map(node => node.path);
  }
}

document.addEventListener("DOMContentLoaded", async (event) => {
  const nav = document.getElementById("navbar");
  if (!nav) {
    return;
  }
  const posts = await getPosts(githubUserId, blogRepositoryName, 'posts');
  console.log(posts);
});