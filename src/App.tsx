import React from 'react';
import { Widget } from './components/Widget';

const App: React.FC = () => {
  return (
    <div className="w-full h-screen overflow-hidden flex flex-col">
      {/* 
        The Window is the app. No need for centering wrappers or backgrounds.
        We just render the Widget directly.
      */}
      <Widget />
    </div>
  );
};

export default App;