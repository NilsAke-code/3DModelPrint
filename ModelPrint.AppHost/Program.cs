var builder = DistributedApplication.CreateBuilder(args);

var api = builder.AddProject<Projects.ModelPrint_Api>("api");

builder.AddNpmApp("frontend", "../modelprint-frontend", "dev")
    .WithReference(api)
    .WaitFor(api)
    .WithHttpEndpoint(port: 5173, env: "PORT");

builder.Build().Run();
