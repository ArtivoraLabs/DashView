const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.static("public"));


const TOKEN = "YOUR_GITHUB_TOKEN";
const ORG = "ArtivoraLabs";


app.get("/api/dashboard", async(req,res)=>{


const query = `

{
 organization(login:"${ORG}") {


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



 projectsV2(first:10){

 nodes{

 title
 number
 closed

 items(first:100){

 nodes{

 type

 content{

 ... on Issue {

 title
 state

 }

 }

 }

 }


 }


 }


}

}

`;



const response = await fetch(
"https://api.github.com/graphql",
{

method:"POST",

headers:{

Authorization:`Bearer ${TOKEN}`,

"Content-Type":"application/json"

},


body:JSON.stringify({
query
})


});


const data = await response.json();


res.json(data.data);


});




app.listen(3000,()=>{

console.log(
"DashView running on port 3000"
);

});
