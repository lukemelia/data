var get = Ember.get, set = Ember.set;
var Person, Company, store, adapter, container;

module("integration/adapter/subscribe - Finding and Subscribing to Records", {
  setup: function() {
    Person = DS.Model.extend({
      typeKey: 'person', // TODO deal with this
      updatedAt: DS.attr('string'),
      firstName: DS.attr('string'),
      lastName: DS.attr('string')
    });
    Company = DS.Model.extend({
      typeKey: 'company', // TODO deal with this
      name: DS.attr('string')
    });
  },
  teardown: function() {
    store.destroy();
  }
});

test("When a single record is requested, the adapter's find method should be called unless it's loaded.", function() {
  expect(3);

  var mockService = Ember.Object.createWithMixins(Ember.Evented, {
    update: function(type, payload) {
      this.trigger('update', type, payload);
    },
    subscribe: function(type, id, callback){
      this.on('update', callback);
    },
    unsubscribe: function(type, id){
      this.off('update');
    }
  });
  DS.Model.reopen({
    subscribe: function(){
      return this.get('store').subscribe(this);
    },
    unsubscribe: function(){
      return this.get('store').unsubscribe(this);
    }
  });
  DS.Store.reopen({
    subscribe: function(record){
      return this.adapterFor(record).subscribe(this, record);
    },
    unsubscribe: function(record){
      return this.adapterFor(record).unsubscribe(this, record);
    }
  });
  var Adapter = DS.Adapter.extend({
    init: function(){
      this._super();
      this._services = {};
    },
    willDestroy: function(){
      this._super();
      this.service.off('update');
      this.service = null;
    },
    find: function(store, type, id) {
      return { people: [{ id: 1, firstName: "Braaaahm" }] };
    },
    subscribe: function(store, record) {
      var type = record.constructor.typeKey;
      var service = this.serviceFor(type);
      service.subscribe(type, record.get('id'), function(type, payload){
        store.pushPayload(type, payload);
      });
    },
    unsubscribe: function(store, record) {
      var type = record.constructor.typeKey;
      var service = this.serviceFor(type);
      service.unsubscribe(type, record.get('id'));
    },
    serviceFor: function(type) {
      var service = this._services[type];
      if (!service) {
        service = this._services[type] = mockService; //TODO: container lookup
        if (!service) { throw new Error('no service found for ' + type); }
      }
      return service;
    }
  });
  var env = setupStore({
    person: Person,
    adapter: Adapter
  });
  env.container.register('serializer:person', DS.RESTSerializer);
  store = env.store;
  stop();

  var person;
  store.find('person', 1).then(function(p){
    person = p;
    equal(get(person, 'firstName'), 'Braaaahm', "firstName should be set");
    return person.subscribe();
  }).then(function(){
    Ember.run(function(){ mockService.update('person', { people: [ {id: 1, firstName: 'Yolo'} ]} ); });
    equal(get(person, 'firstName'), 'Yolo', "firstName should be updated");
  }).then(function(){
    return person.unsubscribe();
  }).then(function(){
    Ember.run(function(){ mockService.update('person', { people: [{ id: 1, firstName: 'Baba'} ]}); });
    equal(get(person, 'firstName'), 'Yolo', "firstName should not be updated");
  }).then(start, start);
});
