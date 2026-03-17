require "sinatra"
require "json"

set :port, ENV.fetch("PORT", 8080).to_i
set :bind, "0.0.0.0"

get "/" do
  content_type :json
  { message: "Hello from Ruby Sinatra!" }.to_json
end
