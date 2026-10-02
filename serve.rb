#!/usr/bin/env ruby
require 'webrick'

port = 8080
root = File.expand_path(__dir__)

server = WEBrick::HTTPServer.new(
  Port: port,
  DocumentRoot: root,
  AccessLog: [],
  Logger: WEBrick::Log.new(nil, WEBrick::Log::WARN)
)

trap('INT') { server.shutdown }
puts "Serving #{root} on http://localhost:#{port}"
server.start
