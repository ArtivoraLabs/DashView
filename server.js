const express = require("express");
const cors = require("cors");


const app = express();


app.use(cors());


const TOKEN =
"YOUR_GITHUB_TOKEN";


const ORG =
"ArtivoraLabs";




app.get(
"/api/dashboard",
async(req,res)=>{


const query = `

{

organization(login:"${ORG}"){


projectsV2(first:10){


nodes{


title

number

closed


items(first:100){


nodes{


content{


... on Issue{


title

state


}


}


}


}


}


}



repositories(first:20){


nodes{


name

description


primaryLanguage{

name

}


stargazerCount

forkCount

updatedAt


}


}



}


}

`;





const response =
await fetch(

"https://api.github.com/graphql",

{

method:"POST",


headers:{


Authorization:
`Bearer ${TOKEN}`,

"Content-Type":
"application/json"


},


body:JSON.stringify({

query

})


}


);





const result =
await response.json();



res.json(
result.data
);



});





app.listen(3000,()=>{


console.log(
"DashView Server running on 3000"
);


});
