const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());

const TOKEN = "YOUR_GITHUB_TOKEN";
const ORG = "YOUR_ORGANIZATION_NAME";


app.get("/dashboard-data", async (req,res)=>{

const query = `
{
 organization(login:"${ORG}") {

  projectsV2(first:10){

   nodes{

    title
    number

    items(first:50){

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

res.json(data);

});


app.listen(3000,()=>{
console.log("DashView Live Server Running");
});