const API = "http://localhost:3000/api/dashboard";


async function loadDashboard(){

try{


const response = await fetch(API);

const data = await response.json();



const projects =
data.projectsV2.nodes;


const repositories =
data.repositories.nodes;



// PROJECT COUNT

document.querySelector("#projectCount")
.innerHTML =
projects.length;



// REPOSITORY COUNT

document.querySelector("#repoCount")
.innerHTML =
repositories.length;



// PROJECT DATA


let projectNames=[];

let taskCounts=[];



projects.forEach(project=>{


projectNames.push(
project.title
);



taskCounts.push(
project.items.nodes.length
);



});






// PROJECT CHART


new Chart(

document.getElementById(
"progressChart"
),

{

type:"doughnut",

data:{


labels:projectNames,


datasets:[{

data:taskCounts,


backgroundColor:[

"#38bdf8",

"#a855f7"

]


}]


}


});





// TASK STATUS


let completed=0;

let pending=0;



projects.forEach(project=>{


project.items.nodes.forEach(item=>{


if(
item.content?.state==="OPEN"
){

pending++;

}

else{

completed++;

}


});


});





new Chart(

document.getElementById(
"taskChart"
),

{

type:"bar",

data:{

labels:[

"Completed",

"Pending"

],


datasets:[{

label:"Tasks",

data:[

completed,

pending

],


backgroundColor:[

"#22c55e",

"#ef4444"

]


}]


}


});







// PROJECT CARDS


let html="";



projects.forEach(project=>{


html += `


<div class="project-card">


<h2>

${project.title}

</h2>


<p>

Project #${project.number}

</p>


<span class="tag">

${project.closed ?
"Closed":
"Active"}

</span>


<p>

Tasks:

${project.items.nodes.length}

</p>


</div>


`;



});



document.querySelector(
".projects"
).innerHTML=html;



}

catch(error){

console.log(error);

}


}



loadDashboard();
