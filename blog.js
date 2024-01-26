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

async function _posts() {
  const directories = await getRootDirectories(githubUserId, blogRepositoryName);
  const postDirectory = directories.filter(dir => dir.path === 'posts');
  if (!postDirectory) {
    return;
  }
  return await getPosts(postDirectory[0].url);
}
