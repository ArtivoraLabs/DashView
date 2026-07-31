const organization = "YOUR_ORGANIZATION_NAME";

fetch(`https://api.github.com/orgs/${organization}/repos`)
.then(response => response.json())
.then(repos => {

    let output = "";

    repos.forEach(repo => {

        output += `
        <div class="card">
            <h2>${repo.name}</h2>
            <p>Language: ${repo.language || "N/A"}</p>
            <p>Stars: ${repo.stargazers_count}</p>
            <p>Updated: ${repo.updated_at}</p>
        </div>
        `;

    });

    document.getElementById("projects").innerHTML = output;

})
.catch(() => {
    document.getElementById("projects").innerHTML =
    "Unable to load GitHub data";
});